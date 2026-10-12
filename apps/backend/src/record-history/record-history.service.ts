import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
    RECORD_HISTORY_DEFAULT_RETENTION_DAYS,
    RECORD_HISTORY_RETENTION_KEY,
    RECORD_HISTORY_SETTING_KEYS,
    RECORD_HISTORY_SETTINGS_GROUP,
    type RecordHistoryAction,
    type RecordHistoryChange,
    type RecordHistoryEntityType,
} from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { createdAtRange } from '../common/created-range.util';
import { DEFAULT_TENANT_TIMEZONE } from '../common/tenant-time.util';
import { diffSnapshots } from './record-history.diff';
import { SNAPSHOT_LOADERS, type RecordSnapshot } from './record-history.snapshots';

export interface RecordHistoryEntry {
    tenantId: string;
    entityType: RecordHistoryEntityType;
    entityId: string;
    action: RecordHistoryAction;
    before: RecordSnapshot | null;
    after: RecordSnapshot | null;
    userId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}

export interface RecordHistoryQuery {
    tenantId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    userId?: string;
    /** Matches the label (invoice number, name) or an exact record id. */
    q?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
}

/** How many changed paths a list row carries; the detail view has them all. */
const SUMMARY_PATHS = 6;

@Injectable()
export class RecordHistoryService {
    private readonly logger = new Logger(RecordHistoryService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /** Read through the platform-settings cache, so this costs nothing per request. */
    async isEnabled(entityType: RecordHistoryEntityType): Promise<boolean> {
        const value = await this.platformSettings.getRawValue(
            RECORD_HISTORY_SETTINGS_GROUP,
            RECORD_HISTORY_SETTING_KEYS[entityType],
        );
        return value !== 'false';
    }

    snapshot(entityType: RecordHistoryEntityType, id: string): Promise<RecordSnapshot | null> {
        return SNAPSHOT_LOADERS[entityType](this.db, id);
    }

    /**
     * Store one change. An edit that moved nothing a snapshot shows is
     * dropped: the audit trail already says the request happened, and a
     * history full of "no changes" rows hides the ones that matter.
     */
    async write(entry: RecordHistoryEntry): Promise<boolean> {
        const changes: RecordHistoryChange[] | null =
            entry.before && entry.after ? diffSnapshots(entry.before.data, entry.after.data) : null;
        if (entry.action === 'UPDATE' && changes && changes.length === 0) return false;

        await this.db.recordHistory.create({
            data: {
                tenant_id: entry.tenantId,
                entity_type: entry.entityType,
                entity_id: entry.entityId,
                entity_label: entry.after?.label ?? entry.before?.label ?? null,
                action: entry.action,
                before: (entry.before?.data as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                after: (entry.after?.data as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                changes: changes ? (changes as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
                change_count: changes?.length ?? 0,
                user_id: entry.userId ?? null,
                ip_address: entry.ipAddress ?? null,
                user_agent: entry.userAgent ?? null,
            },
        });
        return true;
    }

    async query(options: RecordHistoryQuery) {
        const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
        const offset = Math.max(options.offset ?? 0, 0);

        const where: Prisma.RecordHistoryWhereInput = {};
        if (options.tenantId) where.tenant_id = options.tenantId;
        if (options.entityType) where.entity_type = options.entityType;
        if (options.entityId) where.entity_id = options.entityId;
        if (options.action) where.action = options.action;
        if (options.userId) where.user_id = options.userId;
        const q = options.q?.trim();
        if (q) {
            where.OR = [
                { entity_label: { contains: q, mode: 'insensitive' } },
                { entity_id: q },
            ];
        }
        // Platform-wide, so no one workspace's calendar applies; the platform's
        // own zone, as the admin audit trail uses.
        const created = createdAtRange(options.from, options.to, DEFAULT_TENANT_TIMEZONE);
        if (created) where.created_at = created;

        const [rows, total] = await Promise.all([
            this.db.recordHistory.findMany({
                where,
                orderBy: { created_at: 'desc' },
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    tenant_id: true,
                    entity_type: true,
                    entity_id: true,
                    entity_label: true,
                    action: true,
                    changes: true,
                    change_count: true,
                    ip_address: true,
                    created_at: true,
                    user: { select: { id: true, name: true, email: true } },
                },
            }),
            this.db.recordHistory.count({ where }),
        ]);

        const tenantNames = await this.tenantNames(rows.map((row) => row.tenant_id));
        return {
            rows: rows.map(({ changes, ...row }) => ({
                ...row,
                tenant_name: tenantNames.get(row.tenant_id) ?? null,
                // The list shows which fields moved, not the values: a sale
                // edit's full change list can be long and is one click away.
                changed_paths: Array.isArray(changes)
                    ? (changes as unknown as RecordHistoryChange[]).slice(0, SUMMARY_PATHS).map((change) => change.path)
                    : [],
            })),
            total,
            limit,
            offset,
        };
    }

    async findOne(id: string) {
        const row = await this.db.recordHistory.findUnique({
            where: { id },
            include: { user: { select: { id: true, name: true, email: true } } },
        });
        if (!row) throw new NotFoundException('History entry not found');
        const tenantNames = await this.tenantNames([row.tenant_id]);
        return { ...row, tenant_name: tenantNames.get(row.tenant_id) ?? null };
    }

    private async tenantNames(ids: string[]): Promise<Map<string, string>> {
        const unique = [...new Set(ids)];
        if (!unique.length) return new Map();
        const tenants = await this.db.tenant.findMany({
            where: { id: { in: unique } },
            select: { id: true, name: true },
        });
        return new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    }

    /** The configured retention, or the default when unset or unreadable. `0` keeps everything. */
    async retentionDays(): Promise<number> {
        const raw = await this.platformSettings.getRawValue(RECORD_HISTORY_SETTINGS_GROUP, RECORD_HISTORY_RETENTION_KEY);
        const days = Number.parseInt(raw ?? '', 10);
        return Number.isFinite(days) && days >= 0 ? days : RECORD_HISTORY_DEFAULT_RETENTION_DAYS;
    }

    // 01:45 Bangladesh time, in the night batch window, after the 01:30
    // general data-retention purge. See `JOB_REGISTRY`.
    @Cron('45 1 * * *', { timeZone: 'Asia/Dhaka' })
    async purgeExpired(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.RECORD_HISTORY_PURGE, () => this.purgeExpiredImpl());
    }

    async purgeExpiredImpl(): Promise<number> {
        const days = await this.retentionDays();
        if (days === 0) return 0;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const { count } = await this.db.recordHistory.deleteMany({ where: { created_at: { lt: cutoff } } });
        this.logger.log(`[RecordHistory] Purged ${count} rows older than ${days} days`);
        return count;
    }
}
