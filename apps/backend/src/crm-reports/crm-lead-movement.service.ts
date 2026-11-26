import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { clampWindow, percent, resolveDateWindow } from '../common/dashboard-window';
import { REPORT_MAX_DAYS } from './follow-up-compliance.service';
import {
    assignMovementStage,
    MovementLanding,
    MovementStageMeta,
} from './lead-movement.fold';

export type { MovementStageMeta };

export type LeadMovementStageRow = MovementStageMeta & {
    count: number;
    share_pct: number | null;
};

export type LeadMovementReport = {
    filters: { from: string; to: string; mine: boolean; status_ids: string[] };
    available_stages: MovementStageMeta[];
    stages: LeadMovementStageRow[];
    totals: { moved: number; converted: number; lost: number; conversion_pct: number | null };
};

function bySortThenName(a: MovementStageMeta, b: MovementStageMeta): number {
    return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

function toMeta(row: {
    id: string;
    code: string;
    name: string;
    lifecycle: string;
    is_system: boolean;
    is_active: boolean;
    sort_order: number;
}): MovementStageMeta {
    return {
        id: row.id,
        code: row.code,
        name: row.name,
        lifecycle: row.lifecycle,
        is_system: row.is_system,
        is_active: row.is_active,
        sort_order: row.sort_order,
    };
}

/**
 * Distinct leads that changed stage in the window, counted once at the furthest
 * visible stage (Lost as its own outcome when it is the latest landing).
 *
 * Landings outside `[fromDate, toDate]` are not loaded, so last month's
 * Qualified does not outrank this month's Contacted. `mine` is the current
 * owner, resolved from the session, never a client-supplied id.
 */
@Injectable()
export class CrmLeadMovementService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        timezone: string,
        query: { from?: string; to?: string; mine?: boolean; statusIds?: string[] },
        ownerId?: string,
    ): Promise<LeadMovementReport> {
        const window = clampWindow(resolveDateWindow(query, timezone), REPORT_MAX_DAYS);

        const events = await this.db.leadStatusEvent.findMany({
            where: {
                tenant_id: tenantId,
                created_at: { gte: window.fromDate, lte: window.toDate },
                lead: {
                    tenant_id: tenantId,
                    ...(ownerId ? { assigned_to: ownerId } : {}),
                },
            },
            select: {
                id: true,
                lead_id: true,
                to_status_id: true,
                to_lifecycle: true,
                created_at: true,
            },
        });

        const landedIds = [...new Set(
            events
                .map((event) => event.to_status_id)
                .filter((id): id is string => id != null),
        )];

        const optionWhere: Prisma.LeadStatusOptionWhereInput = {
            tenant_id: tenantId,
            OR: landedIds.length > 0
                ? [{ is_active: true }, { id: { in: landedIds } }]
                : [{ is_active: true }],
        };

        const optionRows = await this.db.leadStatusOption.findMany({
            where: optionWhere,
            select: {
                id: true,
                code: true,
                name: true,
                lifecycle: true,
                is_system: true,
                is_active: true,
                sort_order: true,
            },
        });

        const options = optionRows.map(toMeta);
        const metaById = new Map(options.map((option) => [option.id, option]));
        const landed = new Set(landedIds);

        const available_stages = options
            .filter((option) => option.is_active || landed.has(option.id))
            .sort(bySortThenName);

        const requested = [...new Set((query.statusIds ?? []).filter((id) => metaById.has(id)))];
        const visibleMetas = requested.length > 0
            ? requested.map((id) => metaById.get(id)!)
            : options.filter((option) => option.is_active);

        const visibleIds = new Set(visibleMetas.map((option) => option.id));

        const byLead = new Map<string, MovementLanding[]>();
        for (const event of events) {
            const landing: MovementLanding = {
                id: event.id,
                leadId: event.lead_id,
                toStatusId: event.to_status_id,
                toLifecycle: event.to_lifecycle,
                createdAt: event.created_at,
            };
            const landings = byLead.get(landing.leadId) ?? [];
            landings.push(landing);
            byLead.set(landing.leadId, landings);
        }

        const counts = new Map<string, number>();
        for (const id of visibleIds) counts.set(id, 0);

        let converted = 0;
        let lost = 0;
        for (const landings of byLead.values()) {
            const stageId = assignMovementStage(landings, visibleIds, metaById);
            if (!stageId) continue;
            counts.set(stageId, (counts.get(stageId) ?? 0) + 1);
            const lifecycle = metaById.get(stageId)?.lifecycle;
            if (lifecycle === 'CONVERTED') converted += 1;
            else if (lifecycle === 'LOST') lost += 1;
        }

        const moved = [...counts.values()].reduce((sum, count) => sum + count, 0);

        const stages: LeadMovementStageRow[] = [...visibleMetas]
            .sort((a, b) => {
                if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
                return bySortThenName(a, b);
            })
            .map((option) => {
                const count = counts.get(option.id) ?? 0;
                return { ...option, count, share_pct: percent(count, moved) };
            });

        return {
            filters: {
                from: window.from,
                to: window.to,
                mine: Boolean(query.mine),
                status_ids: stages.map((row) => row.id),
            },
            available_stages,
            stages,
            totals: {
                moved,
                converted,
                lost,
                conversion_pct: percent(converted, converted + lost),
            },
        };
    }
}
