import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import {
    OrgImportDepartmentRowDto, OrgImportDesignationRowDto, OrgImportLevelRowDto, OrgStructureImportDto,
} from './employee.dto';
import { cleanText, findReportingCycle, normaliseCode } from './employees.service';

export interface OrgSheetResult {
    created: number;
    updated: number;
    /** Already in the ERP and identical to the file. */
    unchanged: number;
    /** Already in the ERP; left alone because the import ran in `skip` mode. */
    skipped: number;
}

export interface OrgImportResult {
    /** True when nothing was written: a dry run, or a file with errors. */
    dry_run: boolean;
    applied: boolean;
    levels: OrgSheetResult;
    departments: OrgSheetResult;
    designations: OrgSheetResult;
    /** Every problem, each naming its sheet and row. Any error blocks the whole import. */
    errors: string[];
}

type Mode = 'skip' | 'upsert';

/** What happens to one record. `id` is the existing row, or a fresh UUID for a new one. */
interface Planned<T> {
    id: string;
    action: 'create' | 'update' | 'unchanged' | 'skip';
    /** Set on a deleted row brought back by this import. */
    revive: boolean;
    data: T;
}

interface LevelData { level: number; name: string; is_active: boolean }
interface DepartmentData { name: string; code: string | null; description: string | null; reports_to: string | null; is_active: boolean }
interface DesignationData {
    name: string;
    code: string | null;
    department_id: string | null;
    level_id: string | null;
    reports_to_id: string | null;
    reports_to_note: string | null;
    remarks: string | null;
    is_active: boolean;
}

const ACTIVE_WORDS = new Set(['', 'active', 'yes', 'y', 'true', '1', 'enabled']);
const INACTIVE_WORDS = new Set(['inactive', 'no', 'n', 'false', '0', 'disabled', 'deactivated', 'deactive']);

/** `Active` / `Inactive` and the usual spellings of each. Blank means active. */
function parseStatus(value: unknown): boolean | 'invalid' {
    const word = value == null ? '' : String(value).trim().toLowerCase();
    if (ACTIVE_WORDS.has(word)) return true;
    if (INACTIVE_WORDS.has(word)) return false;
    return 'invalid';
}

/** A whole number from a cell that may hold `3`, `3.0` or `"3"`. */
function parseLevel(value: unknown): number | null {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(String(value).trim());
    return Number.isInteger(n) && n >= 1 && n <= 99 ? n : NaN;
}

const lower = (value: string) => value.toLowerCase();

function emptyResult(): OrgSheetResult {
    return { created: 0, updated: 0, unchanged: 0, skipped: 0 };
}

function sameData<T extends object>(existing: Record<string, unknown>, next: T): boolean {
    return Object.entries(next).every(([key, value]) => (existing[key] ?? null) === (value ?? null));
}

/**
 * Imports a designation master — levels, departments and designations — from
 * the three sheets of one workbook, in that order, because each refers to the
 * one before.
 *
 * All or nothing. The whole file is checked first and any error blocks the
 * import, so a tenant never ends up with half an org chart whose reporting
 * lines point at designations that did not make it in. A dry run returns the
 * same report without writing, which is what the import dialog's preview shows.
 *
 * Records are matched by code first, then by name (or by number, for levels),
 * so re-importing a corrected file updates what the first import created
 * rather than duplicating it. A designation sheet on its own also works: a
 * department or level it names that does not exist yet is created from the
 * name in the same row.
 */
@Injectable()
export class OrgStructureImportService {
    constructor(private readonly db: DatabaseService) {}

    async import(tenantId: string, dto: OrgStructureImportDto): Promise<OrgImportResult> {
        const mode: Mode = dto.mode;
        const errors: string[] = [];
        const result: OrgImportResult = {
            dry_run: !!dto.dry_run,
            applied: false,
            levels: emptyResult(),
            departments: emptyResult(),
            designations: emptyResult(),
            errors,
        };

        const [existingLevels, existingDepartments, existingDesignations] = await Promise.all([
            this.db.designationLevel.findMany({ where: { tenant_id: tenantId } }),
            this.db.department.findMany({ where: { tenant_id: tenantId } }),
            this.db.designation.findMany({ where: { tenant_id: tenantId } }),
        ]);

        // ── Levels ───────────────────────────────────────────────────────────
        const levels: Planned<LevelData>[] = [];
        const levelByNumber = new Map<number, string>();
        for (const l of existingLevels) if (!l.deleted_at) levelByNumber.set(l.level, l.id);

        const planLevel = (data: LevelData): Planned<LevelData> => {
            const live = existingLevels.find((l) => l.level === data.level && !l.deleted_at);
            const dead = live ? undefined : existingLevels.find((l) => l.level === data.level);
            const plan = this.plan(mode, live ?? dead, !!dead, data);
            levels.push(plan);
            levelByNumber.set(data.level, plan.id);
            return plan;
        };

        const seenLevels = new Set<number>();
        (dto.levels ?? []).forEach((row: OrgImportLevelRowDto, i) => {
            const where = `Level sheet row ${i + 2}`;
            const level = parseLevel(row.level);
            const name = cleanText(row.name);
            const status = parseStatus(row.status);
            if (level === null && !name) return; // a blank line
            if (level === null || Number.isNaN(level)) { errors.push(`${where}: level must be a whole number from 1 to 99.`); return; }
            if (!name) { errors.push(`${where}: level ${level} has no name.`); return; }
            if (status === 'invalid') { errors.push(`${where}: status "${row.status}" should be Active or Inactive.`); return; }
            if (seenLevels.has(level)) { errors.push(`${where}: level ${level} appears more than once.`); return; }
            seenLevels.add(level);
            planLevel({ level, name, is_active: status });
        });

        // ── Departments ──────────────────────────────────────────────────────
        const departments: Planned<DepartmentData>[] = [];
        const deptByCode = new Map<string, string>();
        const deptByName = new Map<string, string>();
        for (const d of existingDepartments) {
            if (d.deleted_at) continue;
            if (d.code) deptByCode.set(d.code, d.id);
            deptByName.set(lower(d.name), d.id);
        }

        const findDepartment = (code: string | null, name: string) => {
            const live = existingDepartments.filter((d) => !d.deleted_at);
            return (code ? live.find((d) => d.code === code) : undefined)
                ?? live.find((d) => lower(d.name) === lower(name));
        };

        const planDepartment = (data: DepartmentData, where: string): Planned<DepartmentData> | null => {
            const live = findDepartment(data.code, data.name);
            const dead = live ? undefined : existingDepartments.find((d) => d.deleted_at && lower(d.name) === lower(data.name));
            if (live && data.code && live.code !== data.code && mode === 'upsert') {
                const holder = existingDepartments.find((d) => d.code === data.code && d.id !== live.id);
                if (holder) {
                    errors.push(`${where}: code ${data.code} already belongs to the department "${holder.name}".`);
                    return null;
                }
            }
            if (live && mode === 'upsert' && lower(live.name) !== lower(data.name)) {
                const holder = existingDepartments.find((d) => !d.deleted_at && d.id !== live.id && lower(d.name) === lower(data.name));
                if (holder) {
                    errors.push(`${where}: another department is already called "${data.name}".`);
                    return null;
                }
            }
            const plan = this.plan(mode, live ?? dead, !!dead, data);
            departments.push(plan);
            if (data.code) deptByCode.set(data.code, plan.id);
            if (live?.code) deptByCode.set(live.code, plan.id);
            deptByName.set(lower(data.name), plan.id);
            return plan;
        };

        const seenDeptCodes = new Set<string>();
        const seenDeptNames = new Set<string>();
        (dto.departments ?? []).forEach((row: OrgImportDepartmentRowDto, i) => {
            const where = `Department sheet row ${i + 2}`;
            const code = normaliseCode(row.code);
            const name = cleanText(row.name);
            const status = parseStatus(row.status);
            if (!code && !name) return;
            if (!name) { errors.push(`${where}: department ${code} has no name.`); return; }
            if (status === 'invalid') { errors.push(`${where}: status "${row.status}" should be Active or Inactive.`); return; }
            if (code && seenDeptCodes.has(code)) { errors.push(`${where}: code ${code} appears more than once.`); return; }
            if (seenDeptNames.has(lower(name))) { errors.push(`${where}: "${name}" appears more than once.`); return; }
            if (code) seenDeptCodes.add(code);
            seenDeptNames.add(lower(name));
            planDepartment({
                name,
                code,
                description: cleanText(row.description),
                reports_to: cleanText(row.reports_to),
                is_active: status,
            }, where);
        });

        // ── Designations ─────────────────────────────────────────────────────
        const rows = (dto.designations ?? []).map((row: OrgImportDesignationRowDto, i) => ({
            row,
            where: `Designation sheet row ${i + 2}`,
            code: normaliseCode(row.code),
            name: cleanText(row.name),
        })).filter((r) => r.code || r.name);

        // Every code the file defines, so a reporting line may point at a row
        // further down the sheet.
        const designations: Planned<DesignationData>[] = [];
        const desigByCode = new Map<string, string>();
        for (const d of existingDesignations) if (!d.deleted_at && d.code) desigByCode.set(d.code, d.id);

        const seenCodes = new Set<string>();
        const seenNames = new Set<string>();
        const pending: { plan: Planned<DesignationData>; reportsToCode: string | null; where: string }[] = [];

        for (const { row, where, code, name } of rows) {
            if (!name) { errors.push(`${where}: designation ${code} has no name.`); continue; }
            if (code && seenCodes.has(code)) { errors.push(`${where}: code ${code} appears more than once.`); continue; }
            if (seenNames.has(lower(name))) { errors.push(`${where}: "${name}" appears more than once.`); continue; }
            if (code) seenCodes.add(code);
            seenNames.add(lower(name));

            const status = parseStatus(row.status);
            if (status === 'invalid') { errors.push(`${where}: status "${row.status}" should be Active or Inactive.`); continue; }

            // Department: by code, then by name; created from the row if new.
            let departmentId: string | null = null;
            const deptCode = normaliseCode(row.department_code);
            const deptName = cleanText(row.department_name);
            if (deptCode || deptName) {
                departmentId = (deptCode ? deptByCode.get(deptCode) : undefined)
                    ?? (deptName ? deptByName.get(lower(deptName)) : undefined)
                    ?? null;
                if (!departmentId) {
                    if (!deptName) {
                        errors.push(`${where}: department ${deptCode} is not in the Department sheet or the ERP.`);
                        continue;
                    }
                    const created = planDepartment(
                        { name: deptName, code: deptCode, description: null, reports_to: null, is_active: true },
                        where,
                    );
                    if (!created) continue;
                    departmentId = created.id;
                }
            }

            // Level: by number; created from the row's level name if new.
            let levelId: string | null = null;
            const levelNumber = parseLevel(row.level);
            if (Number.isNaN(levelNumber)) {
                errors.push(`${where}: level "${row.level}" must be a whole number from 1 to 99.`);
                continue;
            }
            if (levelNumber !== null) {
                levelId = levelByNumber.get(levelNumber) ?? null;
                if (!levelId) {
                    const levelName = cleanText(row.level_name);
                    if (!levelName) {
                        errors.push(`${where}: level ${levelNumber} is not in the Level sheet or the ERP.`);
                        continue;
                    }
                    levelId = planLevel({ level: levelNumber, name: levelName, is_active: true }).id;
                }
            }

            const live = existingDesignations.filter((d) => !d.deleted_at);
            const match = (code ? live.find((d) => d.code === code) : undefined)
                ?? live.find((d) => lower(d.name) === lower(name));
            const dead = match ? undefined : existingDesignations.find((d) => d.deleted_at && lower(d.name) === lower(name));

            if (match && mode === 'upsert') {
                if (code && match.code !== code) {
                    const holder = live.find((d) => d.code === code && d.id !== match.id);
                    if (holder) { errors.push(`${where}: code ${code} already belongs to "${holder.name}".`); continue; }
                }
                if (lower(match.name) !== lower(name)) {
                    const holder = live.find((d) => d.id !== match.id && lower(d.name) === lower(name));
                    if (holder) { errors.push(`${where}: another designation is already called "${name}".`); continue; }
                }
            }

            const reportsToCode = normaliseCode(row.reports_to_code);
            const plan = this.plan(mode, match ?? dead, !!dead, {
                name,
                code,
                department_id: departmentId,
                level_id: levelId,
                // Wired in the second pass, once every code in the file is known.
                reports_to_id: null,
                reports_to_note: reportsToCode ? null : cleanText(row.reports_to_name),
                remarks: cleanText(row.remarks),
                is_active: status,
            });
            designations.push(plan);
            if (code) desigByCode.set(code, plan.id);
            if (match?.code && match.code !== code) desigByCode.set(match.code, plan.id);
            pending.push({ plan, reportsToCode, where });
        }

        // Second pass: reporting lines.
        for (const { plan, reportsToCode, where } of pending) {
            if (!reportsToCode) continue;
            const target = desigByCode.get(reportsToCode);
            if (!target) {
                errors.push(`${where}: reports to ${reportsToCode}, which is not in the Designation sheet or the ERP.`);
                continue;
            }
            if (target === plan.id) {
                errors.push(`${where}: a designation cannot report to itself.`);
                continue;
            }
            plan.data.reports_to_id = target;
        }

        // A skipped row keeps the reporting line it already has in the ERP.
        const parentOf = new Map<string, string | null>();
        for (const d of existingDesignations) if (!d.deleted_at) parentOf.set(d.id, d.reports_to_id);
        for (const p of designations) if (p.action !== 'skip') parentOf.set(p.id, p.data.reports_to_id);
        for (const { plan, where } of pending) {
            if (plan.action !== 'skip' && findReportingCycle(parentOf, plan.id)) {
                errors.push(`${where}: the reporting line loops back to "${plan.data.name}".`);
            }
        }

        // Unchanged is decided last: reporting lines were only just resolved.
        for (const p of designations) {
            if ((p.action === 'update' || p.action === 'unchanged') && !p.revive) {
                const existing = existingDesignations.find((d) => d.id === p.id)!;
                p.action = sameData(existing, p.data) ? 'unchanged' : 'update';
            }
        }

        tally(result.levels, levels);
        tally(result.departments, departments);
        tally(result.designations, designations);

        if (errors.length > 0 || dto.dry_run) {
            result.dry_run = true;
            return result;
        }

        await this.db.$transaction(async (tx) => {
            for (const p of levels) {
                if (p.action === 'create') {
                    await tx.designationLevel.create({ data: { id: p.id, tenant_id: tenantId, ...p.data } });
                } else if (p.action === 'update') {
                    await tx.designationLevel.update({ where: { id: p.id }, data: { ...p.data, deleted_at: null } });
                }
            }
            for (const p of departments) {
                if (p.action === 'create') {
                    await tx.department.create({ data: { id: p.id, tenant_id: tenantId, ...p.data } });
                } else if (p.action === 'update') {
                    await tx.department.update({ where: { id: p.id }, data: { ...p.data, deleted_at: null } });
                }
            }
            // Reporting lines go in after every designation exists, so the
            // order of rows in the sheet never matters.
            for (const p of designations) {
                const data = { ...p.data, reports_to_id: undefined };
                if (p.action === 'create') {
                    await tx.designation.create({ data: { id: p.id, tenant_id: tenantId, ...data } });
                } else if (p.action === 'update') {
                    await tx.designation.update({ where: { id: p.id }, data: { ...data, deleted_at: null } });
                }
            }
            for (const p of designations) {
                if (p.action === 'create' || p.action === 'update') {
                    await tx.designation.update({ where: { id: p.id }, data: { reports_to_id: p.data.reports_to_id } });
                }
            }
        }, { timeout: 60_000 });

        result.applied = true;
        return result;
    }

    /**
     * Create, update, leave unchanged or skip — and which id the record will
     * have, so later sheets can point at it before anything is written.
     */
    private plan<T extends object>(
        mode: Mode,
        existing: ({ id: string } & Record<string, any>) | undefined,
        revive: boolean,
        data: T,
    ): Planned<T> {
        if (!existing) return { id: randomUUID(), action: 'create', revive: false, data };
        if (revive) return { id: existing.id, action: 'update', revive: true, data };
        if (mode === 'skip') return { id: existing.id, action: 'skip', revive: false, data };
        return { id: existing.id, action: sameData(existing, data) ? 'unchanged' : 'update', revive: false, data };
    }
}

function tally<T>(into: OrgSheetResult, plans: Planned<T>[]) {
    for (const p of plans) {
        // A deleted row brought back reads as new to the person importing it.
        if (p.action === 'create' || p.revive) into.created++;
        else if (p.action === 'update') into.updated++;
        else if (p.action === 'unchanged') into.unchanged++;
        else into.skipped++;
    }
}
