import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import {
    CreateEmployeeDto, UpdateEmployeeDto, CreateDepartmentDto, UpdateDepartmentDto,
    CreateDesignationDto, UpdateDesignationDto, CreateDesignationLevelDto, UpdateDesignationLevelDto,
} from './employee.dto';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { runImport, ImportResult } from '../common/import.util';
import { TenantContext } from '../database/tenant.decorator';
import { canViewPayroll, stripPayrollFields } from '../common/payroll-visibility';

/**
 * What the HR screens need to know about the login behind an employee.
 *
 * `mobile` is the identifier they actually sign in with — `email` is often a
 * placeholder for staff who have none (see `placeholderEmailFor`), so showing it
 * would be showing a machine address. `must_change_password` is true while an
 * HR-set password has not been replaced, which the detail page surfaces so
 * nobody wonders why the person cannot get past the sign-in screen.
 *
 * Nothing sensitive: no hash, no token version, no 2FA secret.
 */
const EMPLOYEE_USER_SELECT = {
    id: true,
    email: true,
    name: true,
    mobile: true,
    must_change_password: true,
} as const;

/** What a designation carries when shown: where it sits and who it reports to. */
export const DESIGNATION_RELATIONS = {
    department: { select: { id: true, name: true, code: true, is_active: true } },
    level: { select: { id: true, level: true, name: true, is_active: true } },
    reportsTo: { select: { id: true, name: true, code: true, is_active: true } },
} as const;

/** The employee's own relations, with the designation's place in the hierarchy. */
const EMPLOYEE_INCLUDE = {
    department: true,
    designation: { include: DESIGNATION_RELATIONS },
    user: { select: EMPLOYEE_USER_SELECT },
} as const;

/** `?status=active|inactive` on a master list; anything else lists both. */
function activeFilter(status?: string): { is_active?: boolean } {
    if (status === 'active') return { is_active: true };
    if (status === 'inactive') return { is_active: false };
    return {};
}

/** Codes compare case-insensitively, so they are stored upper-case. Blank clears. */
export function normaliseCode(value: unknown): string | null {
    if (value == null) return null;
    const code = String(value).trim().toUpperCase();
    return code === '' ? null : code;
}

export function cleanText(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}

/**
 * Whether following `parentOf` up from `start` comes back to `start`. Stops at
 * the first repeat, so a loop elsewhere in the chart cannot spin it forever.
 */
export function findReportingCycle(parentOf: Map<string, string | null>, start: string): boolean {
    const seen = new Set<string>();
    let cursor = parentOf.get(start) ?? null;
    while (cursor) {
        if (cursor === start) return true;
        if (seen.has(cursor)) return false;
        seen.add(cursor);
        cursor = parentOf.get(cursor) ?? null;
    }
    return false;
}

@Injectable()
export class EmployeesService {
    constructor(
        private db: DatabaseService,
        private encryption: EncryptionService,
    ) {}

    private encryptNid(value: string | undefined | null): string | undefined {
        if (value == null) return undefined;
        return this.encryption.encrypt(value);
    }

    private decryptNid(value: string | undefined | null): string | undefined {
        if (value == null) return undefined;
        return this.encryption.decrypt(value);
    }

    private decryptEmployee<T extends { nid?: string | null }>(emp: T): T {
        return { ...emp, nid: this.decryptNid(emp.nid) };
    }

    /**
     * Prisma DateTime rejects a date-only string (`YYYY-MM-DD`) with
     * "premature end of input. Expected ISO-8601 DateTime". The employee form's
     * `<input type="date">` posts exactly that, and `@IsDateString()` accepts it.
     */
    private toJoiningDate(value: string | undefined): Date | undefined {
        if (value == null || value === '') return undefined;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException('Invalid date of joining.');
        }
        return date;
    }

    /**
     * Whether `viewer` may see salary figures.
     *
     * `viewer` is optional so the existing `(tenantId, ...)` call shape still
     * compiles, but **omitting it strips the salary** rather than exposing it.
     * The fail-safe direction matters more than the ergonomics here: a call site
     * that forgets to thread the viewer through loses a field visibly, where the
     * opposite default would leak every salary in the tenant silently.
     */
    private canSeeSalary(viewer?: TenantContext): Promise<boolean> {
        if (!viewer) return Promise.resolve(false);
        return canViewPayroll(this.db, viewer);
    }

    private async generateEmployeeCode(tenantId: string): Promise<string> {
        const last = await this.db.employee.findFirst({
            where: { tenant_id: tenantId },
            orderBy: { employee_code: 'desc' },
            select: { employee_code: true },
        });

        if (!last) return 'EMP-00001';
        const match = last.employee_code.match(/EMP-(\d+)/);
        const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
        return `EMP-${String(nextNum).padStart(5, '0')}`;
    }

    // ── Departments ───────────────────────────────────────────────────────────

    /**
     * Every department that has not been deleted, active or not: reports and
     * filters need the retired ones to read history. Pickers that offer a
     * department for a *new* assignment filter to `is_active` themselves.
     */
    async listDepartments(tenantId: string, opts: { status?: string } = {}) {
        return this.db.department.findMany({
            where: { tenant_id: tenantId, deleted_at: null, ...activeFilter(opts.status) },
            orderBy: { name: 'asc' },
            include: {
                _count: {
                    select: {
                        employees: { where: { deleted_at: null } },
                        designations: { where: { deleted_at: null } },
                    },
                },
            },
        });
    }

    async createDepartment(tenantId: string, dto: CreateDepartmentDto) {
        const name = dto.name.trim();
        const code = normaliseCode(dto.code);
        await this.assertDepartmentUnique(tenantId, name, code);

        const data = {
            name,
            code,
            description: cleanText(dto.description),
            reports_to: cleanText(dto.reports_to),
            is_active: dto.is_active ?? true,
        };

        // A department deleted earlier still holds its name in the unique index;
        // bring it back rather than fail on a name nobody can see.
        const deleted = await this.db.department.findFirst({
            where: { tenant_id: tenantId, name, NOT: { deleted_at: null } },
            select: { id: true },
        });
        if (deleted) {
            return this.db.department.update({ where: { id: deleted.id }, data: { ...data, deleted_at: null } });
        }
        return this.db.department.create({ data: { tenant_id: tenantId, ...data } });
    }

    async updateDepartment(tenantId: string, id: string, dto: UpdateDepartmentDto) {
        const dept = await this.db.department.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!dept) throw new NotFoundException('Department not found.');

        const name = dto.name !== undefined ? dto.name.trim() : undefined;
        const code = dto.code !== undefined ? normaliseCode(dto.code) : undefined;
        await this.assertDepartmentUnique(tenantId, name, code, id);

        return this.db.department.update({
            where: { id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(code !== undefined ? { code } : {}),
                ...(dto.description !== undefined ? { description: cleanText(dto.description) } : {}),
                ...(dto.reports_to !== undefined ? { reports_to: cleanText(dto.reports_to) } : {}),
                ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
            },
        });
    }

    async deleteDepartment(tenantId: string, id: string) {
        const dept = await this.db.department.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!dept) throw new NotFoundException('Department not found.');

        const [assigned, designations] = await Promise.all([
            this.db.employee.count({ where: { department_id: id, deleted_at: null } }),
            this.db.designation.count({ where: { department_id: id, deleted_at: null } }),
        ]);
        if (assigned > 0 || designations > 0) throw new BadRequestException('This department is still in use.');

        // The code is released so it can be given to a new department; the
        // name stays, which is what lets `createDepartment` revive the row.
        return this.db.department.update({ where: { id }, data: { deleted_at: new Date(), code: null } });
    }

    private async assertDepartmentUnique(tenantId: string, name?: string, code?: string | null, exceptId?: string) {
        const not = exceptId ? { NOT: { id: exceptId } } : {};
        if (name !== undefined) {
            const duplicate = await this.db.department.findFirst({
                where: { tenant_id: tenantId, name: { equals: name, mode: 'insensitive' }, deleted_at: null, ...not },
            });
            if (duplicate) throw new ConflictException('A department with this name already exists.');
        }
        if (code) {
            const duplicate = await this.db.department.findFirst({
                where: { tenant_id: tenantId, code, ...not },
            });
            if (duplicate) throw new ConflictException('A department with this code already exists.');
        }
    }

    // ── Designation levels ────────────────────────────────────────────────────

    async listDesignationLevels(tenantId: string, opts: { status?: string } = {}) {
        return this.db.designationLevel.findMany({
            where: { tenant_id: tenantId, deleted_at: null, ...activeFilter(opts.status) },
            orderBy: { level: 'asc' },
            include: { _count: { select: { designations: { where: { deleted_at: null } } } } },
        });
    }

    async createDesignationLevel(tenantId: string, dto: CreateDesignationLevelDto) {
        const name = dto.name.trim();
        await this.assertLevelUnique(tenantId, dto.level);
        const data = { name, is_active: dto.is_active ?? true };

        const deleted = await this.db.designationLevel.findFirst({
            where: { tenant_id: tenantId, level: dto.level, NOT: { deleted_at: null } },
            select: { id: true },
        });
        if (deleted) {
            return this.db.designationLevel.update({ where: { id: deleted.id }, data: { ...data, deleted_at: null } });
        }
        return this.db.designationLevel.create({ data: { tenant_id: tenantId, level: dto.level, ...data } });
    }

    async updateDesignationLevel(tenantId: string, id: string, dto: UpdateDesignationLevelDto) {
        const level = await this.db.designationLevel.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!level) throw new NotFoundException('Level not found.');
        if (dto.level !== undefined && dto.level !== level.level) {
            await this.assertLevelUnique(tenantId, dto.level, id);
        }

        return this.db.designationLevel.update({
            where: { id },
            data: {
                ...(dto.level !== undefined ? { level: dto.level } : {}),
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
            },
        });
    }

    async deleteDesignationLevel(tenantId: string, id: string) {
        const level = await this.db.designationLevel.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!level) throw new NotFoundException('Level not found.');

        const used = await this.db.designation.count({ where: { level_id: id, deleted_at: null } });
        if (used > 0) throw new BadRequestException('This level is still in use.');

        return this.db.designationLevel.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    private async assertLevelUnique(tenantId: string, level: number, exceptId?: string) {
        // Deleted rows hold their number in the unique index too. Creating
        // revives such a row; renumbering onto one would collide, so refuse it.
        const duplicate = await this.db.designationLevel.findFirst({
            where: {
                tenant_id: tenantId,
                level,
                ...(exceptId ? { NOT: { id: exceptId } } : { deleted_at: null }),
            },
        });
        if (duplicate) throw new ConflictException('This level number already exists.');
    }

    // ── Designations ──────────────────────────────────────────────────────────

    async listDesignations(
        tenantId: string,
        opts: { departmentId?: string; levelId?: string; status?: string } = {},
    ) {
        return this.db.designation.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                ...activeFilter(opts.status),
                ...(opts.departmentId ? { department_id: opts.departmentId } : {}),
                ...(opts.levelId ? { level_id: opts.levelId } : {}),
            },
            orderBy: [{ code: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
            include: {
                ...DESIGNATION_RELATIONS,
                _count: { select: { employees: { where: { deleted_at: null } } } },
            },
        });
    }

    async createDesignation(tenantId: string, dto: CreateDesignationDto) {
        const name = dto.name.trim();
        const code = normaliseCode(dto.code);
        await this.assertDesignationUnique(tenantId, name, code);
        await this.assertDesignationLinks(tenantId, dto, null);

        const data = {
            name,
            code,
            department_id: dto.department_id ?? null,
            level_id: dto.level_id ?? null,
            reports_to_id: dto.reports_to_id ?? null,
            reports_to_note: cleanText(dto.reports_to_note),
            remarks: cleanText(dto.remarks),
            is_active: dto.is_active ?? true,
        };

        const deleted = await this.db.designation.findFirst({
            where: { tenant_id: tenantId, name, NOT: { deleted_at: null } },
            select: { id: true },
        });
        if (deleted) {
            return this.db.designation.update({
                where: { id: deleted.id },
                data: { ...data, deleted_at: null },
                include: DESIGNATION_RELATIONS,
            });
        }
        return this.db.designation.create({
            data: { tenant_id: tenantId, ...data },
            include: DESIGNATION_RELATIONS,
        });
    }

    async updateDesignation(tenantId: string, id: string, dto: UpdateDesignationDto) {
        const desig = await this.db.designation.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!desig) throw new NotFoundException('Designation not found.');

        const name = dto.name !== undefined ? dto.name.trim() : undefined;
        const code = dto.code !== undefined ? normaliseCode(dto.code) : undefined;
        await this.assertDesignationUnique(tenantId, name, code, id);
        await this.assertDesignationLinks(tenantId, dto, desig);

        return this.db.designation.update({
            where: { id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(code !== undefined ? { code } : {}),
                ...(dto.department_id !== undefined ? { department_id: dto.department_id } : {}),
                ...(dto.level_id !== undefined ? { level_id: dto.level_id } : {}),
                ...(dto.reports_to_id !== undefined ? { reports_to_id: dto.reports_to_id } : {}),
                ...(dto.reports_to_note !== undefined ? { reports_to_note: cleanText(dto.reports_to_note) } : {}),
                ...(dto.remarks !== undefined ? { remarks: cleanText(dto.remarks) } : {}),
                ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
            },
            include: DESIGNATION_RELATIONS,
        });
    }

    async deleteDesignation(tenantId: string, id: string) {
        const desig = await this.db.designation.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!desig) throw new NotFoundException('Designation not found.');

        const [assigned, reportees] = await Promise.all([
            this.db.employee.count({ where: { designation_id: id, deleted_at: null } }),
            this.db.designation.count({ where: { reports_to_id: id, deleted_at: null } }),
        ]);
        if (assigned > 0 || reportees > 0) throw new BadRequestException('This designation is still in use.');

        return this.db.designation.update({ where: { id }, data: { deleted_at: new Date(), code: null } });
    }

    private async assertDesignationUnique(tenantId: string, name?: string, code?: string | null, exceptId?: string) {
        const not = exceptId ? { NOT: { id: exceptId } } : {};
        if (name !== undefined) {
            const duplicate = await this.db.designation.findFirst({
                where: { tenant_id: tenantId, name: { equals: name, mode: 'insensitive' }, deleted_at: null, ...not },
            });
            if (duplicate) throw new ConflictException('A designation with this name already exists.');
        }
        if (code) {
            const duplicate = await this.db.designation.findFirst({
                where: { tenant_id: tenantId, code, ...not },
            });
            if (duplicate) throw new ConflictException('A designation with this code already exists.');
        }
    }

    /**
     * The department, level and reporting designation must belong to the
     * tenant and still exist. A *newly chosen* one must also be active — an
     * inactive one already on the record may stay, so editing a remark on an
     * old designation does not force anyone to re-home it first.
     */
    private async assertDesignationLinks(
        tenantId: string,
        dto: { department_id?: string | null; level_id?: string | null; reports_to_id?: string | null },
        current: { id: string; department_id: string | null; level_id: string | null; reports_to_id: string | null } | null,
    ) {
        if (dto.department_id && dto.department_id !== current?.department_id) {
            const dept = await this.db.department.findFirst({
                where: { id: dto.department_id, tenant_id: tenantId, deleted_at: null },
            });
            if (!dept) throw new BadRequestException('Department not found.');
            if (!dept.is_active) throw new BadRequestException('This department is inactive.');
        }
        if (dto.level_id && dto.level_id !== current?.level_id) {
            const level = await this.db.designationLevel.findFirst({
                where: { id: dto.level_id, tenant_id: tenantId, deleted_at: null },
            });
            if (!level) throw new BadRequestException('Level not found.');
            if (!level.is_active) throw new BadRequestException('This level is inactive.');
        }
        if (dto.reports_to_id && dto.reports_to_id !== current?.reports_to_id) {
            if (current && dto.reports_to_id === current.id) {
                throw new BadRequestException('A designation cannot report to itself.');
            }
            const all = await this.db.designation.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
                select: { id: true, reports_to_id: true, is_active: true },
            });
            const target = all.find((d) => d.id === dto.reports_to_id);
            if (!target) throw new BadRequestException('Reporting designation not found.');
            if (!target.is_active) throw new BadRequestException('The reporting designation is inactive.');
            if (current) {
                const parentOf = new Map(all.map((d) => [d.id, d.reports_to_id]));
                parentOf.set(current.id, dto.reports_to_id);
                if (findReportingCycle(parentOf, current.id)) {
                    throw new BadRequestException('This reporting line would loop back to the same designation.');
                }
            }
        }
    }

    // ── Employees ─────────────────────────────────────────────────────────────

    async create(tenantId: string, dto: CreateEmployeeDto, viewer?: TenantContext) {
        if (!dto.storeId) throw new BadRequestException('An employee needs a branch.');
        const branch = await this.db.store.findFirst({
            where: { id: dto.storeId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!branch) throw new NotFoundException('Branch not found.');

        const existing = await this.db.employee.findFirst({
            where: { tenant_id: tenantId, phone: dto.phone },
        });
        if (existing) throw new BadRequestException('An employee with this phone number already exists.');

        await this.assertEmployeeAssignment(tenantId, dto, null);

        const employee_code = await this.generateEmployeeCode(tenantId);
        const seesSalary = await this.canSeeSalary(viewer);
        const { nid, basic_salary, storeId, date_of_joining, ...rest } = dto as CreateEmployeeDto & { basic_salary?: unknown };

        // Same rule as `update`: no VIEW_PAYROLL, no salary written. On create
        // there is nothing to overwrite, so this only drops a figure the caller
        // should not have been able to enter in the first place.
        const salaryPatch = seesSalary && basic_salary !== undefined
            ? { basic_salary: basic_salary as any }
            : {};

        const record = await this.db.employee.create({
            data: {
                tenant_id: tenantId,
                employee_code,
                store_id: storeId,
                ...rest,
                ...salaryPatch,
                ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
                ...(date_of_joining ? { date_of_joining: this.toJoiningDate(date_of_joining) } : {}),
            },
            include: EMPLOYEE_INCLUDE,
        });
        return stripPayrollFields(this.decryptEmployee(record), seesSalary);
    }

    /**
     * The department and designation must exist in the tenant, and a newly
     * chosen one must be active. One the employee already holds may stay after
     * it is deactivated — retiring a designation never rewrites anyone's record.
     */
    private async assertEmployeeAssignment(
        tenantId: string,
        dto: { department_id?: string | null; designation_id?: string | null },
        current: { department_id: string | null; designation_id: string | null } | null,
    ) {
        if (dto.department_id && dto.department_id !== current?.department_id) {
            const dept = await this.db.department.findFirst({ where: { id: dto.department_id, tenant_id: tenantId, deleted_at: null } });
            if (!dept) throw new BadRequestException('Department not found.');
            if (dept.is_active === false) throw new BadRequestException('This department is inactive.');
        }
        if (dto.designation_id && dto.designation_id !== current?.designation_id) {
            const desig = await this.db.designation.findFirst({ where: { id: dto.designation_id, tenant_id: tenantId, deleted_at: null } });
            if (!desig) throw new BadRequestException('Designation not found.');
            if (desig.is_active === false) throw new BadRequestException('This designation is inactive.');
        }
    }

    async findAll(
        tenantId: string,
        opts?: { page?: number; limit?: number; search?: string; status?: string; departmentId?: string; storeId?: string },
        viewer?: TenantContext,
    ): Promise<PaginatedResult<any>> {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId, deleted_at: null };
        if (opts?.status) where.status = opts.status;
        if (opts?.departmentId) where.department_id = opts.departmentId;
        if (opts?.storeId) where.store_id = opts.storeId;
        if (opts?.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { phone: { contains: opts.search } },
                { employee_code: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const [items, total, seesSalary] = await Promise.all([
            this.db.employee.findMany({
                where,
                include: EMPLOYEE_INCLUDE,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.employee.count({ where }),
            this.canSeeSalary(viewer),
        ]);

        return paginate(
            items.map(e => stripPayrollFields(this.decryptEmployee(e), seesSalary)),
            total,
            page,
            limit,
        );
    }

    async findOne(tenantId: string, id: string, viewer?: TenantContext, storeId?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...(storeId ? { store_id: storeId } : {}) },
            include: EMPLOYEE_INCLUDE,
        });
        if (!employee) throw new NotFoundException('Employee not found');
        return stripPayrollFields(this.decryptEmployee(employee), await this.canSeeSalary(viewer));
    }

    async update(tenantId: string, id: string, dto: UpdateEmployeeDto, viewer?: TenantContext, storeId?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...(storeId ? { store_id: storeId } : {}) },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        if (dto.phone && dto.phone !== employee.phone) {
            const duplicate = await this.db.employee.findFirst({
                where: { tenant_id: tenantId, phone: dto.phone, NOT: { id: employee.id } },
            });
            if (duplicate) throw new BadRequestException('An employee with this phone number already exists.');
        }

        await this.assertEmployeeAssignment(tenantId, dto, employee);

        const seesSalary = await this.canSeeSalary(viewer);
        const { nid, basic_salary, storeId: nextStoreId, date_of_joining, ...rest } = dto as UpdateEmployeeDto & { basic_salary?: unknown };
        if (nextStoreId) {
            const branch = await this.db.store.findFirst({
                where: { id: nextStoreId, tenant_id: tenantId },
                select: { id: true },
            });
            if (!branch) throw new NotFoundException('Branch not found.');
        }

        // A caller who cannot *read* the salary cannot write it either. This is
        // not belt-and-braces: the employee edit form sends `basic_salary` on
        // every save, so without this a VIEW_HR-only user renaming someone
        // would post the stripped field back as `null` and silently wipe a real
        // figure. Dropping it is the graceful outcome — refusing the whole
        // request would make the form unusable for exactly the users who are
        // allowed to use it.
        const salaryPatch = seesSalary && basic_salary !== undefined
            ? { basic_salary: basic_salary as any }
            : {};

        const record = await this.db.employee.update({
            where: { id },
            data: {
                ...rest,
                ...salaryPatch,
                ...(nextStoreId ? { store_id: nextStoreId } : {}),
                ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
                ...(date_of_joining ? { date_of_joining: this.toJoiningDate(date_of_joining) } : {}),
            },
            include: EMPLOYEE_INCLUDE,
        });
        return stripPayrollFields(this.decryptEmployee(record), seesSalary);
    }

    async remove(tenantId: string, id: string, storeId?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...(storeId ? { store_id: storeId } : {}) },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        return this.db.employee.update({
            where: { id },
            data: { deleted_at: new Date(), user_id: null },
        });
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        return runImport(rows, mode, tenantId, {
            requiredFields: ['name'],
            castRow: (raw) => ({
                name: String(raw.name ?? '').trim(),
                phone: raw.phone ? String(raw.phone).trim() || null : null,
                email: raw.email ? String(raw.email).trim() || null : null,
                joining_date: raw.joining_date ? String(raw.joining_date).trim() || null : null,
                salary: (() => {
                    if (raw.salary == null || raw.salary === '') return null;
                    const n = Number(raw.salary);
                    return isNaN(n) ? null : n;
                })(),
            }),
            findDuplicate: async (row) => {
                if (!row.phone) return null;
                const existing = await this.db.employee.findFirst({
                    where: { tenant_id: tenantId, phone: row.phone, deleted_at: null },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                const employee_code = await this.generateEmployeeCode(tenantId);
                await this.db.employee.create({
                    data: {
                        tenant_id: tenantId,
                        employee_code,
                        name: row.name,
                        phone: row.phone,
                        email: row.email,
                        ...(row.joining_date ? { joining_date: new Date(row.joining_date) } : {}),
                        ...(row.salary != null ? { salary: row.salary } : {}),
                    },
                });
            },
            update: async (id, row) => {
                await this.db.employee.update({
                    where: { id },
                    data: {
                        name: row.name,
                        phone: row.phone ?? undefined,
                        email: row.email ?? undefined,
                        ...(row.joining_date ? { joining_date: new Date(row.joining_date) } : {}),
                        ...(row.salary != null ? { salary: row.salary } : {}),
                    },
                });
            },
        });
    }

    async linkUser(tenantId: string, id: string, userId: string, storeId?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...(storeId ? { store_id: storeId } : {}) },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        // Ensure the user belongs to this tenant
        const tenantUser = await this.db.tenantUser.findFirst({
            where: { tenant_id: tenantId, user_id: userId },
        });
        if (!tenantUser) throw new BadRequestException('User does not belong to this tenant.');

        // Ensure the user isn't already linked to another employee
        const alreadyLinked = await this.db.employee.findFirst({
            where: { tenant_id: tenantId, user_id: userId, deleted_at: null },
        });
        if (alreadyLinked && alreadyLinked.id !== id) {
            throw new ConflictException('This user is already linked to another employee.');
        }

        const record = await this.db.employee.update({
            where: { id },
            data: { user_id: userId },
            include: EMPLOYEE_INCLUDE,
        });
        return this.decryptEmployee(record);
    }

    async unlinkUser(tenantId: string, id: string, storeId?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...(storeId ? { store_id: storeId } : {}) },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        const record = await this.db.employee.update({
            where: { id },
            data: { user_id: null },
            include: EMPLOYEE_INCLUDE,
        });
        return this.decryptEmployee(record);
    }
}
