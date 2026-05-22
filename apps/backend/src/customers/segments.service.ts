import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppLogger } from '../common/app-logger.service';
import { DatabaseService } from '../database/database.service';

export const SEGMENT_THRESHOLDS = {
    VIP_SPEND_BDT: 50000,
    AT_RISK_DAYS: 30,
    NEW_ACCOUNT_DAYS: 30,
};

export type SegmentCategory = 'New' | 'Regular' | 'At-Risk' | 'VIP';

@Injectable()
export class SegmentsService {
    constructor(
        private db: DatabaseService,
        private readonly logger: AppLogger,
    ) {}

    classifyCustomer(params: {
        totalSpent: number;
        lastPurchaseDate: Date | null;
        accountCreatedAt: Date;
        now?: Date;
    }): SegmentCategory {
        const now = params.now ?? new Date();
        const { totalSpent, lastPurchaseDate, accountCreatedAt } = params;

        if (totalSpent > SEGMENT_THRESHOLDS.VIP_SPEND_BDT) return 'VIP';

        const refDate = lastPurchaseDate ?? accountCreatedAt;
        const daysSince = (now.getTime() - refDate.getTime()) / (1000 * 3600 * 24);

        if (daysSince > SEGMENT_THRESHOLDS.AT_RISK_DAYS) {
            const accountAgeDays = (now.getTime() - accountCreatedAt.getTime()) / (1000 * 3600 * 24);
            if (accountAgeDays <= SEGMENT_THRESHOLDS.NEW_ACCOUNT_DAYS && !lastPurchaseDate) return 'New';
            return 'At-Risk';
        }

        if (!lastPurchaseDate) {
            const accountAgeDays = (now.getTime() - accountCreatedAt.getTime()) / (1000 * 3600 * 24);
            if (accountAgeDays <= SEGMENT_THRESHOLDS.NEW_ACCOUNT_DAYS) return 'New';
        }

        return 'Regular';
    }

    async evaluateForTenant(tenantId: string): Promise<{ updated: number; total: number }> {
        return this.runForTenant(tenantId);
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
            _max: { created_at: true },
        });

        const lastPurchaseMap = new Map<string, Date>();
        for (const row of lastSaleRows) {
            if (row.customer_id && row._max.created_at) {
                lastPurchaseMap.set(row.customer_id, row._max.created_at);
            }
        }

        const effectiveNow = now ?? new Date();
        let updated = 0;

        for (const customer of customers) {
            const segment = this.classifyCustomer({
                totalSpent: Number(customer.total_spent),
                lastPurchaseDate: lastPurchaseMap.get(customer.id) ?? null,
                accountCreatedAt: customer.created_at,
                now: effectiveNow,
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

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleCron() {
        this.logger.debug('Running Customer Segmentation evaluation (all tenants)');
        const result = await this.runForTenant(null);
        this.logger.log(`Segmentation evaluation complete: updated=${result.updated}, total=${result.total}`);
    }
}
