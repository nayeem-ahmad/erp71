import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppLogger } from '../common/app-logger.service';
import { DatabaseService } from '../database/database.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';

export const SEGMENT_THRESHOLDS = {
    VIP_SPEND_BDT: 50000,
    AT_RISK_DAYS: 30,
    NEW_ACCOUNT_DAYS: 30,
};

export type SegmentThresholds = {
    VIP_SPEND_BDT: number;
    AT_RISK_DAYS: number;
    NEW_ACCOUNT_DAYS: number;
};

export type SegmentCategory = 'New' | 'Regular' | 'At-Risk' | 'VIP';

@Injectable()
export class SegmentsService {
    constructor(
        private db: DatabaseService,
        private readonly logger: AppLogger,
        private readonly jobTracker: JobTrackerService,
    ) {}

    classifyCustomer(params: {
        totalSpent: number;
        lastPurchaseDate: Date | null;
        accountCreatedAt: Date;
        now?: Date;
        thresholds?: SegmentThresholds;
    }): SegmentCategory {
        const now = params.now ?? new Date();
        const { totalSpent, lastPurchaseDate, accountCreatedAt } = params;
        const thresholds = params.thresholds ?? SEGMENT_THRESHOLDS;

        if (totalSpent > thresholds.VIP_SPEND_BDT) return 'VIP';

        const refDate = lastPurchaseDate ?? accountCreatedAt;
        const daysSince = (now.getTime() - refDate.getTime()) / (1000 * 3600 * 24);

        if (daysSince > thresholds.AT_RISK_DAYS) {
            const accountAgeDays = (now.getTime() - accountCreatedAt.getTime()) / (1000 * 3600 * 24);
            if (accountAgeDays <= thresholds.NEW_ACCOUNT_DAYS && !lastPurchaseDate) return 'New';
            return 'At-Risk';
        }

        if (!lastPurchaseDate) {
            const accountAgeDays = (now.getTime() - accountCreatedAt.getTime()) / (1000 * 3600 * 24);
            if (accountAgeDays <= thresholds.NEW_ACCOUNT_DAYS) return 'New';
        }

        return 'Regular';
    }

    async evaluateForTenant(tenantId: string): Promise<{ updated: number; total: number }> {
        return this.runForTenant(tenantId);
    }

    async getThresholdsForTenant(tenantId: string): Promise<SegmentThresholds> {
        const row = await this.db.customerSegmentSettings.findUnique({
            where: { tenant_id: tenantId },
        });
        return row ? this.toThresholds(row) : { ...SEGMENT_THRESHOLDS };
    }

    async updateThresholdsForTenant(
        tenantId: string,
        thresholds: SegmentThresholds,
    ): Promise<SegmentThresholds> {
        const row = await this.db.customerSegmentSettings.upsert({
            where: { tenant_id: tenantId },
            create: {
                tenant_id: tenantId,
                vip_spend_bdt: thresholds.VIP_SPEND_BDT,
                at_risk_days: thresholds.AT_RISK_DAYS,
                new_account_days: thresholds.NEW_ACCOUNT_DAYS,
            },
            update: {
                vip_spend_bdt: thresholds.VIP_SPEND_BDT,
                at_risk_days: thresholds.AT_RISK_DAYS,
                new_account_days: thresholds.NEW_ACCOUNT_DAYS,
            },
        });
        return this.toThresholds(row);
    }

    async runForTenant(tenantId: string | null, now?: Date): Promise<{ updated: number; total: number }> {
        const where = tenantId ? { tenant_id: tenantId } : {};
        const customers = await this.db.customer.findMany({ where });

        const lastSaleRows = await this.db.sale.groupBy({
            by: ['customer_id'],
            where: {
                ...(tenantId ? { tenant_id: tenantId } : {}),
                customer_id: { not: null },
            },
            _max: { sale_date: true },
        });

        const lastPurchaseMap = new Map<string, Date>();
        for (const row of lastSaleRows) {
            if (row.customer_id && row._max.sale_date) {
                lastPurchaseMap.set(row.customer_id, row._max.sale_date);
            }
        }

        const thresholdsByTenant = await this.loadThresholds(tenantId);
        const effectiveNow = now ?? new Date();
        let updated = 0;

        for (const customer of customers) {
            const thresholds = thresholdsByTenant.get(customer.tenant_id) ?? SEGMENT_THRESHOLDS;
            const segment = this.classifyCustomer({
                totalSpent: Number(customer.total_spent),
                lastPurchaseDate: lastPurchaseMap.get(customer.id) ?? null,
                accountCreatedAt: customer.created_at,
                now: effectiveNow,
                thresholds,
            });

            if (segment !== customer.segment_category) {
                await this.db.customer.update({
                    where: { id: customer.id },
                    data: { segment_category: segment },
                });
                updated++;
            }
        }

        this.logger.debug(`Segmentation complete: updated=${updated}, total=${customers.length}`);
        return { updated, total: customers.length };
    }

    private async loadThresholds(tenantId: string | null): Promise<Map<string, SegmentThresholds>> {
        const map = new Map<string, SegmentThresholds>();
        if (tenantId) {
            map.set(tenantId, await this.getThresholdsForTenant(tenantId));
            return map;
        }
        const rows = await this.db.customerSegmentSettings.findMany();
        for (const row of rows) {
            map.set(row.tenant_id, this.toThresholds(row));
        }
        return map;
    }

    private toThresholds(row: {
        vip_spend_bdt: unknown;
        at_risk_days: number;
        new_account_days: number;
    }): SegmentThresholds {
        return {
            VIP_SPEND_BDT: Number(row.vip_spend_bdt),
            AT_RISK_DAYS: row.at_risk_days,
            NEW_ACCOUNT_DAYS: row.new_account_days,
        };
    }

    // 02:30 Bangladesh time: a full pass over every customer, so it runs in the
    // night batch window, after the 01:00 external sync has pulled the day's
    // sales in. See `JOB_REGISTRY` for the whole night's order.
    @Cron('30 2 * * *', { timeZone: 'Asia/Dhaka' })
    async handleCron() {
        await this.jobTracker.track(JOB_NAMES.CUSTOMER_SEGMENTS, () => this.handleCronImpl());
    }

    private async handleCronImpl() {
        this.logger.debug('Running Customer Segmentation evaluation (all tenants)');
        const result = await this.runForTenant(null);
        this.logger.log(`Segmentation evaluation complete: updated=${result.updated}, total=${result.total}`);
    }
}
