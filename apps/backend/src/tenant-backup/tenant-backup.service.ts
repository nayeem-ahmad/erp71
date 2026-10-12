import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseService } from '../database/database.service';
import { AuthCacheService } from '../database/auth-cache.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { buildBackupPlan, type BackupPlan, type TablePlan } from './backup-plan';

export const TENANT_BACKUP_FORMAT = 'erp71.tenant-backup';
export const TENANT_BACKUP_VERSION = 1;

type Row = Record<string, unknown>;
/** A self-reference held back until the row it points at has been inserted. */
type Deferred = { table: TablePlan; field: string; target: string; id: string; value: string };

export interface TenantBackupFile {
    format: typeof TENANT_BACKUP_FORMAT;
    version: number;
    created_at: string;
    created_by: string | null;
    tenant: { id: string; name: string };
    /** Scalar settings of the `Tenant` row itself. */
    tenant_settings: Row;
    /** Rows per model name. */
    tables: Record<string, Row[]>;
}

export interface RestoreSummary {
    tables: number;
    rows_deleted: number;
    rows_restored: number;
    /** Rows left out because something they require (a user, a parent row) no longer exists. */
    rows_skipped: Record<string, number>;
    /** Optional references cleared for the same reason, e.g. `Sale.cashier_id`. */
    references_cleared: Record<string, number>;
    /** Tables in the file this version of ERP71 no longer has. */
    unknown_tables: string[];
    /** Columns in the file this version no longer has, as `Model.column`. */
    unknown_columns: string[];
}

/** One `createMany` / `VALUES` batch. Far under Postgres's 65 535 bind-parameter limit for any table here. */
const CHUNK = 500;

/**
 * A restore deletes and re-inserts every table a workspace has; a store with a
 * year of sales is tens of thousands of rows, which is minutes, not Prisma's
 * 5-second default. All of it is one transaction, so a failure part-way leaves
 * the workspace exactly as it was.
 */
const RESTORE_TX_OPTIONS = { timeout: 15 * 60_000, maxWait: 60_000 };
const BACKUP_TX_OPTIONS = {
    timeout: 5 * 60_000,
    maxWait: 60_000,
    // Every table read from the same snapshot, so a sale written mid-backup is
    // either wholly in it (with its items and voucher) or not at all.
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
};

/**
 * Whole-workspace backup and restore for platform admins.
 *
 * A backup is every row of every table the tenant owns (see `backup-plan.ts`)
 * plus the tenant's own settings, as gzipped JSON. A restore replaces the
 * tenant's data with a backup *of the same tenant*: row ids are kept, so the
 * file cannot be loaded into a different workspace. Uploaded files (logos,
 * attachments) live outside the database and are referenced by URL, not copied.
 */
@Injectable()
export class TenantBackupService {
    private planCache?: BackupPlan;

    constructor(
        private readonly db: DatabaseService,
        private readonly authCache: AuthCacheService,
        private readonly timezones: TenantTimezoneService,
    ) {}

    private get plan(): BackupPlan {
        return (this.planCache ??= buildBackupPlan());
    }

    async createBackup(tenantId: string, createdBy: string | null): Promise<{ file: TenantBackupFile; gzip: Buffer; rows: number }> {
        const { tables, tenantColumns } = this.plan;
        const file = await this.db.$transaction(async (tx) => {
            const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
            const out: Record<string, Row[]> = {};
            for (const table of tables) {
                const rows: Row[] = await (tx as any)[table.delegate].findMany({ where: table.scope(tenantId) });
                if (rows.length) out[table.model] = rows;
            }
            const settings: Row = {};
            for (const column of tenantColumns) settings[column] = (tenant as Row)[column];
            const backup: TenantBackupFile = {
                format: TENANT_BACKUP_FORMAT,
                version: TENANT_BACKUP_VERSION,
                created_at: new Date().toISOString(),
                created_by: createdBy,
                tenant: { id: tenant.id, name: tenant.name },
                tenant_settings: settings,
                tables: out,
            };
            return backup;
        }, BACKUP_TX_OPTIONS);

        const rows = Object.values(file.tables).reduce((n, r) => n + r.length, 0);
        const json = JSON.stringify(file, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
        return { file, gzip: gzipSync(Buffer.from(json)), rows };
    }

    /** Parse and sanity-check an uploaded backup (gzipped or plain JSON). */
    parseBackup(buffer: Buffer): TenantBackupFile {
        let text: string;
        try {
            const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
            text = (isGzip ? gunzipSync(buffer) : buffer).toString('utf8');
        } catch {
            throw new BadRequestException('The file is not a readable backup (gzip decompression failed).');
        }
        let parsed: any;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new BadRequestException('The file is not a readable backup (invalid JSON).');
        }
        if (parsed?.format !== TENANT_BACKUP_FORMAT) {
            throw new BadRequestException('The file is not an ERP71 tenant backup.');
        }
        if (typeof parsed.version !== 'number' || parsed.version > TENANT_BACKUP_VERSION) {
            throw new BadRequestException(`Backup format version ${parsed.version} is newer than this server understands.`);
        }
        if (typeof parsed.tenant?.id !== 'string' || !parsed.tables || typeof parsed.tables !== 'object') {
            throw new BadRequestException('The backup is missing its tenant or tables.');
        }
        for (const [model, rows] of Object.entries(parsed.tables)) {
            if (!Array.isArray(rows)) throw new BadRequestException(`The backup's "${model}" table is not a list of rows.`);
        }
        return parsed as TenantBackupFile;
    }

    /**
     * Replace the tenant's data with the backup's. The tenant row itself is
     * updated, not replaced: its owner, billing state and platform switches are
     * left as they are now (`TENANT_COLUMNS_NOT_RESTORED`).
     */
    async restoreBackup(tenantId: string, backup: TenantBackupFile): Promise<RestoreSummary> {
        if (backup.tenant.id !== tenantId) {
            throw new BadRequestException(
                `This backup belongs to another workspace ("${backup.tenant.name}"). A backup can only be restored into the workspace it was taken from.`,
            );
        }
        const { tables, tenantColumns } = this.plan;
        const known = new Map(tables.map((t) => [t.model, t]));
        const summary: RestoreSummary = {
            tables: 0,
            rows_deleted: 0,
            rows_restored: 0,
            rows_skipped: {},
            references_cleared: {},
            unknown_tables: Object.keys(backup.tables).filter((m) => !known.has(m)).sort(),
            unknown_columns: [],
        };

        // Users are platform-wide and are not in the backup; a member deleted
        // since it was taken cannot come back, and neither can what requires them.
        const existingUsers = await this.existingUserIds(tables, backup);

        try {
            await this.db.$transaction(async (tx) => {
                const t = tx as any;

                // --- Delete, children first. Self-references go first so a
                // row's parent is never deleted out from under it mid-statement.
                for (const table of tables) {
                    for (const fk of table.foreignKeys.filter((f) => f.deferred)) {
                        await t[table.delegate].updateMany({
                            where: { ...table.scope(tenantId), [fk.field]: { not: null } },
                            data: { [fk.field]: null },
                        });
                    }
                }
                for (const table of [...tables].reverse()) {
                    const { count } = await t[table.delegate].deleteMany({ where: table.scope(tenantId) });
                    summary.rows_deleted += count;
                }

                // --- Insert, parents first.
                const inserted = new Map<string, Set<string>>();
                const deferred: Deferred[] = [];
                for (const table of tables) {
                    const ids = new Set<string>();
                    inserted.set(table.model, ids);
                    const source = backup.tables[table.model] ?? [];
                    if (!source.length) continue;

                    const columns = new Map(table.columns.map((c) => [c.name, c]));
                    const rows: Row[] = [];
                    for (const raw of source) {
                        // Some tenant columns carry no foreign key; a row stamped
                        // with any other tenant has no business in this restore.
                        if (table.tenantColumn && raw[table.tenantColumn] !== tenantId) {
                            bump(summary.rows_skipped, table.model);
                            continue;
                        }
                        const row = this.toInsertRow(table, columns, raw, summary);
                        if (!this.resolveReferences(table, row, tenantId, inserted, existingUsers, deferred, summary)) continue;
                        rows.push(row);
                        if (table.hasId) ids.add(row.id as string);
                    }
                    for (let i = 0; i < rows.length; i += CHUNK) {
                        await t[table.delegate].createMany({ data: rows.slice(i, i + CHUNK) });
                    }
                    summary.rows_restored += rows.length;
                    summary.tables++;
                }

                // --- Fill in the self-references now that every row exists.
                const resolvable = deferred.filter((d) => inserted.get(d.target)?.has(d.value));
                for (const d of deferred) {
                    if (!inserted.get(d.target)?.has(d.value)) bump(summary.references_cleared, `${d.table.model}.${d.field}`);
                }
                await this.applyDeferred(tx, resolvable);

                await this.restoreTenantSettings(tx, tenantId, backup.tenant_settings ?? {}, tenantColumns, inserted.get('Store'));
                await this.ensureOwnerMembership(tx, tenantId);
            }, RESTORE_TX_OPTIONS);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const target = (error.meta?.target as string[] | string | undefined) ?? '';
                throw new BadRequestException(
                    `Restore stopped: a value in the backup is now used elsewhere (${error.meta?.modelName ?? 'unique'}: ${[target].flat().join(', ')}). Nothing was changed.`,
                );
            }
            // A backup from an older schema can lack a column that is now
            // required; say so rather than a bare 500.
            if (error instanceof Prisma.PrismaClientValidationError || error instanceof Prisma.PrismaClientKnownRequestError) {
                const detail = error.message.trim().split('\n').pop();
                throw new BadRequestException(`Restore failed and nothing was changed: ${detail}`);
            }
            throw error;
        }

        this.authCache.invalidateTenant(tenantId);
        this.timezones.invalidate(tenantId);
        summary.unknown_columns.sort();
        return summary;
    }

    /** A backup row in the shape `createMany` takes: current columns only, typed back from JSON. */
    private toInsertRow(table: TablePlan, columns: Map<string, TablePlan['columns'][number]>, raw: Row, summary: RestoreSummary): Row {
        for (const key of Object.keys(raw)) {
            if (!columns.has(key)) {
                const name = `${table.model}.${key}`;
                if (!summary.unknown_columns.includes(name)) summary.unknown_columns.push(name);
            }
        }
        const row: Row = {};
        for (const column of table.columns) {
            if (!(column.name in raw)) continue;
            row[column.name] = reviveValue(column, raw[column.name]);
        }
        return row;
    }

    /**
     * Check each reference on `row` points at something that exists. An
     * optional one that does not is cleared; a required one means the row is
     * skipped. A self-reference is held back for `applyDeferred`. Returns
     * whether the row is kept.
     */
    private resolveReferences(
        table: TablePlan,
        row: Row,
        tenantId: string,
        inserted: Map<string, Set<string>>,
        existingUsers: Set<string>,
        deferred: Deferred[],
        summary: RestoreSummary,
    ): boolean {
        const held: { field: string; target: string; value: string }[] = [];
        for (const fk of table.foreignKeys) {
            const value = row[fk.field];
            if (value === null || value === undefined) continue;
            if (fk.deferred) {
                held.push({ field: fk.field, target: fk.target, value: value as string });
                row[fk.field] = null;
                continue;
            }
            const exists = fk.internal
                ? inserted.get(fk.target)?.has(value as string)
                : fk.target === 'Tenant'
                    ? value === tenantId
                    : fk.target === 'User'
                        ? existingUsers.has(value as string)
                        : true;
            if (exists) continue;
            if (fk.required) {
                bump(summary.rows_skipped, table.model);
                return false;
            }
            row[fk.field] = null;
            bump(summary.references_cleared, `${table.model}.${fk.field}`);
        }
        for (const h of held) deferred.push({ table, ...h, id: row.id as string });
        return true;
    }

    /**
     * Raw SQL rather than `update`: Prisma's `update` would stamp `updated_at`
     * with now, and a restore should leave every row as the backup had it.
     */
    private async applyDeferred(tx: Prisma.TransactionClient, items: Deferred[]) {
        const groups = new Map<string, typeof items>();
        for (const item of items) {
            const key = `${item.table.model}.${item.field}`;
            groups.set(key, [...(groups.get(key) ?? []), item]);
        }
        for (const group of groups.values()) {
            const { table, field } = group[0];
            const column = table.columns.find((c) => c.name === field)!.dbName;
            const idColumn = table.columns.find((c) => c.name === 'id')!.dbName;
            for (let i = 0; i < group.length; i += CHUNK) {
                const slice = group.slice(i, i + CHUNK);
                const values = slice.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(', ');
                await tx.$executeRawUnsafe(
                    `UPDATE "${table.dbName}" AS t SET "${column}" = v.value FROM (VALUES ${values}) AS v(id, value) WHERE t."${idColumn}" = v.id`,
                    ...slice.flatMap((s) => [s.id, s.value]),
                );
            }
        }
    }

    private async restoreTenantSettings(
        tx: Prisma.TransactionClient,
        tenantId: string,
        settings: Row,
        tenantColumns: string[],
        restoredStores: Set<string> | undefined,
    ) {
        const tenantModel = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Tenant')!;
        const data: Row = {};
        for (const name of tenantColumns) {
            if (!(name in settings)) continue;
            const field = tenantModel.fields.find((f) => f.name === name)!;
            data[name] = reviveValue({ type: field.type, kind: field.kind, required: field.isRequired }, settings[name]);
        }
        // A plain column, not a relation: it must name a branch that came back.
        if (typeof data.online_store_id === 'string' && !restoredStores?.has(data.online_store_id)) {
            data.online_store_id = null;
        }
        // Globally unique: if another shop has taken the address since, keep this one's current address.
        if (typeof data.storefront_slug === 'string') {
            const taken = await tx.tenant.findFirst({
                where: { storefront_slug: data.storefront_slug, id: { not: tenantId } },
                select: { id: true },
            });
            if (taken) delete data.storefront_slug;
        }
        if (Object.keys(data).length) await tx.tenant.update({ where: { id: tenantId }, data });
    }

    /** Whoever owns the workspace now must still be able to get into it after the restore. */
    private async ensureOwnerMembership(tx: Prisma.TransactionClient, tenantId: string) {
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { owner_id: true } });
        const member = await tx.tenantUser.findUnique({
            where: { tenant_id_user_id: { tenant_id: tenantId, user_id: tenant.owner_id } },
            select: { id: true, role: true },
        });
        if (!member) {
            await tx.tenantUser.create({ data: { tenant_id: tenantId, user_id: tenant.owner_id, role: 'OWNER' } });
        } else if (member.role !== 'OWNER') {
            await tx.tenantUser.update({ where: { id: member.id }, data: { role: 'OWNER' } });
        }
    }

    private async existingUserIds(tables: TablePlan[], backup: TenantBackupFile): Promise<Set<string>> {
        const wanted = new Set<string>();
        for (const table of tables) {
            const userFields = table.foreignKeys.filter((fk) => fk.target === 'User').map((fk) => fk.field);
            if (!userFields.length) continue;
            for (const row of backup.tables[table.model] ?? []) {
                for (const field of userFields) {
                    if (typeof row[field] === 'string') wanted.add(row[field] as string);
                }
            }
        }
        const found = new Set<string>();
        const ids = [...wanted];
        for (let i = 0; i < ids.length; i += 5000) {
            const users = await this.db.user.findMany({ where: { id: { in: ids.slice(i, i + 5000) } }, select: { id: true } });
            users.forEach((u) => found.add(u.id));
        }
        return found;
    }
}

function bump(counts: Record<string, number>, key: string) {
    counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * JSON gives back strings for dates and nulls for JSON columns; `createMany`
 * wants `Date`s, and `Prisma.DbNull` to write SQL NULL into a JSON column.
 * Decimals stay strings, which Prisma accepts as-is without float rounding.
 */
export function reviveValue(column: { type: string; kind: string; required: boolean }, value: unknown): unknown {
    if (column.type === 'Json') {
        if (value === null || value === undefined) return column.required ? Prisma.JsonNull : Prisma.DbNull;
        return value;
    }
    if (value === null || value === undefined) return value;
    if (column.type === 'DateTime') {
        return Array.isArray(value) ? value.map((v) => new Date(v as string)) : new Date(value as string);
    }
    if (column.type === 'BigInt') {
        return Array.isArray(value) ? value.map((v) => BigInt(v as string)) : BigInt(value as string);
    }
    return value;
}
