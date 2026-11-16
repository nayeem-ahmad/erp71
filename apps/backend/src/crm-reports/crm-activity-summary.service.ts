import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { CrmDashboardQueryDto } from '../crm-dashboard/crm-dashboard.dto';
import {
    DateWindow,
    resolveDateWindow,
    clampWindow,
    percent,
} from '../common/dashboard-window';
import { REPORT_MAX_DAYS } from './follow-up-compliance.service';

/**
 * The column a planned touch with no channel falls into. Sentinel rather than
 * an empty string, so it reads as a real column in the UI instead of a blank
 * header.
 */
export const UNSPECIFIED_CHANNEL = 'UNSPECIFIED';

export type ActivitySummaryChannel = {
    code: string;
    name: string;
    total: number;
};

export type ActivitySummaryRow = {
    user_id: string | null;
    name: string | null;
    /** Keyed by channel code. A channel the person did not use is absent. */
    counts: Record<string, number>;
    total: number;
    share_pct: number | null;
};

export type CrmActivitySummaryReport = {
    filters: { from: string; to: string; mine: boolean };
    channels: ActivitySummaryChannel[];
    rows: ActivitySummaryRow[];
    totals: { total: number; unspecified: number; counts: Record<string, number> };
};

/**
 * How much work each person logged in the window, and of what type.
 *
 * **Completed work only.** `completed_at` dates a logged touch; `created_at`
 * dates the plan it may have come from, and `due_at` dates an intention. A
 * register of what happened reads `completed_at` and `status = 'DONE'`, which
 * is also what the scorecard's "activities logged" counts — the two must agree.
 *
 * **Type is the channel** (call, WhatsApp, visit…), because that is what "what
 * kind of activity" means in this product. The channel `code` is denormalised
 * onto the activity, so a channel deleted since still appears rather than
 * taking its activities out of the totals with it — they are relabelled with
 * the raw code, which is better than a column that silently loses rows.
 */
@Injectable()
export class CrmActivitySummaryService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        query: CrmDashboardQueryDto,
        timezone: string,
        ownerId?: string,
    ): Promise<CrmActivitySummaryReport> {
        const window = clampWindow(resolveDateWindow(query, timezone), REPORT_MAX_DAYS);

        const where: Prisma.CrmActivityWhereInput = {
            tenant_id: tenantId,
            status: 'DONE',
            completed_at: { gte: window.fromDate, lte: window.toDate },
        };
        if (ownerId) {
            where.assigned_to = ownerId;
        }

        const [activities, configuredChannels] = await Promise.all([
            this.db.crmActivity.findMany({
                where,
                select: {
                    assigned_to: true,
                    channel_code: true,
                },
            }),
            this.db.conversationChannel.findMany({
                where: { tenant_id: tenantId },
                select: { code: true, name: true, sort_order: true, is_active: true },
            }),
        ]);

        const channelNames = new Map<string, string>();
        for (const channel of configuredChannels) {
            channelNames.set(channel.code, channel.name);
        }
        channelNames.set(UNSPECIFIED_CHANNEL, UNSPECIFIED_CHANNEL);

        // Count per person per channel first, then derive both axes from it —
        // one pass over the rows instead of one per column.
        const perUser = new Map<string | null, Map<string, number>>();
        const channelTotals = new Map<string, number>();
        let unspecified = 0;

        for (const activity of activities) {
            const code = activity.channel_code ?? UNSPECIFIED_CHANNEL;
            if (code === UNSPECIFIED_CHANNEL) unspecified++;

            let counts = perUser.get(activity.assigned_to);
            if (!counts) {
                counts = new Map<string, number>();
                perUser.set(activity.assigned_to, counts);
            }
            counts.set(code, (counts.get(code) ?? 0) + 1);

            channelTotals.set(code, (channelTotals.get(code) ?? 0) + 1);
        }

        // Configured channels always appear, at zero if unused, so the columns do
        // not jump around between one month and the next. They keep the tenant's
        // own order; anything that only appears in the data (a deleted channel,
        // the unspecified bucket) follows, A–Z.
        const configuredOrder = new Map<string, number>();
        for (const channel of configuredChannels) {
            if (channel.is_active) configuredOrder.set(channel.code, channel.sort_order);
        }
        const codesInPlay = new Set<string>([
            ...configuredOrder.keys(),
            ...channelTotals.keys(),
        ]);

        const channels: ActivitySummaryChannel[] = [];
        const configuredInPlay = [...codesInPlay]
            .filter((code) => configuredOrder.has(code))
            .sort((a, b) => (configuredOrder.get(a)! - configuredOrder.get(b)!));
        const theRest = [...codesInPlay]
            .filter((code) => !configuredOrder.has(code) && code !== UNSPECIFIED_CHANNEL)
            .sort();
        // The unspecified bucket always sits last: it is a remainder, not a type,
        // and only earns a column once something actually landed in it.
        const orderedCodes = [
            ...configuredInPlay,
            ...theRest,
            ...(channelTotals.has(UNSPECIFIED_CHANNEL) ? [UNSPECIFIED_CHANNEL] : []),
        ];
        for (const code of orderedCodes) {
            channels.push({
                code,
                name: channelNames.get(code) ?? code,
                total: channelTotals.get(code) ?? 0,
            });
        }

        const userIds = [...perUser.keys()].filter((id): id is string => Boolean(id));
        const users = userIds.length
            ? await this.db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, name: true, email: true },
            })
            : [];
        const userNames = new Map<string, string>();
        for (const user of users) {
            userNames.set(user.id, user.name || user.email || '—');
        }

        const total = activities.length;

        const rows: ActivitySummaryRow[] = [];
        for (const [userId, counts] of perUser.entries()) {
            let rowTotal = 0;
            const plain: Record<string, number> = {};
            for (const [code, count] of counts.entries()) {
                plain[code] = count;
                rowTotal += count;
            }
            rows.push({
                user_id: userId,
                name: userId ? (userNames.get(userId) ?? null) : null,
                counts: plain,
                total: rowTotal,
                share_pct: percent(rowTotal, total),
            });
        }
        rows.sort((a, b) => b.total - a.total || (a.name ?? '').localeCompare(b.name ?? ''));

        const totalCounts: Record<string, number> = {};
        for (const code of orderedCodes) {
            totalCounts[code] = channelTotals.get(code) ?? 0;
        }

        return {
            filters: {
                from: window.from,
                to: window.to,
                mine: Boolean(query.mine),
            },
            channels,
            rows,
            totals: { total, unspecified, counts: totalCounts },
        };
    }
}
