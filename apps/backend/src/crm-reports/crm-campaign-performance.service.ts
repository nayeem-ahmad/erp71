import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { CrmDashboardQueryDto } from '../crm-dashboard/crm-dashboard.dto';
import { resolveDateWindow, clampWindow, percent, money } from '../common/dashboard-window';
import { REPORT_MAX_DAYS } from './follow-up-compliance.service';

export type CampaignPerformanceRow = {
    campaign_id: string;
    name: string;
    channel: string;
    status: string;
    sent_at: string | null;
    recipients: number;
    delivered: number;
    failed: number;
    delivery_pct: number | null;
    orders: number;
    revenue: number;
    conversion_pct: number | null;
    revenue_per_order: number | null;
};

export type CampaignChannelRow = {
    channel: string;
    campaigns: number;
    recipients: number;
    delivered: number;
    orders: number;
    revenue: number;
};

export type CampaignPerformanceReport = {
    filters: { from: string; to: string; mine: boolean };
    rows: CampaignPerformanceRow[];
    by_channel: CampaignChannelRow[];
    totals: {
        campaigns: number;
        recipients: number;
        delivered: number;
        failed: number;
        orders: number;
        revenue: number;
        delivery_pct: number | null;
        conversion_pct: number | null;
    };
};

/**
 * What each outbound campaign returned.
 *
 * `CrmCampaign` already stores its own `recipient_count`, `delivered_count`,
 * `failed_count` and the attributed revenue and orders, so this is a read
 * rather than a recomputation — the figures agree with the campaign screen by
 * construction instead of by two implementations happening to match.
 *
 * A **sent** campaign is dated by `sent_at`, not `created_at`: a campaign
 * drafted in October and sent in November belongs to November, which is the
 * month whose sales it could have influenced. Drafts have no `sent_at` and so
 * never appear.
 */
@Injectable()
export class CrmCampaignPerformanceService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        query: CrmDashboardQueryDto,
        timezone: string,
    ): Promise<CampaignPerformanceReport> {
        const window = clampWindow(resolveDateWindow(query, timezone), REPORT_MAX_DAYS);

        const where: Prisma.CrmCampaignWhereInput = {
            tenant_id: tenantId,
            sent_at: { gte: window.fromDate, lte: window.toDate },
        };

        const campaigns = await this.db.crmCampaign.findMany({
            where,
            select: {
                id: true,
                name: true,
                channel: true,
                status: true,
                sent_at: true,
                recipient_count: true,
                delivered_count: true,
                failed_count: true,
                attributed_revenue: true,
                attributed_orders: true,
            },
        });

        const rows: CampaignPerformanceRow[] = campaigns.map((campaign) => {
            const recipients = campaign.recipient_count;
            const delivered = campaign.delivered_count;
            const orders = campaign.attributed_orders;
            const revenue = money(Number(campaign.attributed_revenue));

            return {
                campaign_id: campaign.id,
                name: campaign.name,
                channel: campaign.channel,
                status: campaign.status,
                sent_at: campaign.sent_at ? campaign.sent_at.toISOString() : null,
                recipients,
                delivered,
                failed: campaign.failed_count,
                delivery_pct: percent(delivered, recipients),
                orders,
                revenue,
                // Of the people the campaign actually reached, not of everyone it
                // tried to reach: a failed delivery was never a chance to convert.
                conversion_pct: percent(orders, delivered),
                revenue_per_order: orders > 0 ? money(revenue / orders) : null,
            };
        });

        rows.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);

        const channelTotals = new Map<string, CampaignChannelRow>();
        let recipients = 0;
        let delivered = 0;
        let failed = 0;
        let orders = 0;
        let revenue = 0;

        for (const row of rows) {
            let channel = channelTotals.get(row.channel);
            if (!channel) {
                channel = { channel: row.channel, campaigns: 0, recipients: 0, delivered: 0, orders: 0, revenue: 0 };
                channelTotals.set(row.channel, channel);
            }
            channel.campaigns += 1;
            channel.recipients += row.recipients;
            channel.delivered += row.delivered;
            channel.orders += row.orders;
            channel.revenue += row.revenue;

            recipients += row.recipients;
            delivered += row.delivered;
            failed += row.failed;
            orders += row.orders;
            revenue += row.revenue;
        }

        const by_channel = [...channelTotals.values()]
            .map((row) => ({ ...row, revenue: money(row.revenue) }))
            .sort((a, b) => b.revenue - a.revenue);

        return {
            filters: { from: window.from, to: window.to, mine: Boolean(query.mine) },
            rows,
            by_channel,
            totals: {
                campaigns: rows.length,
                recipients,
                delivered,
                failed,
                orders,
                revenue: money(revenue),
                delivery_pct: percent(delivered, recipients),
                conversion_pct: percent(orders, delivered),
            },
        };
    }
}
