import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        private db: DatabaseService,
        private email: EmailService,
    ) {}

    // Run daily at 08:00
    @Cron('0 8 * * *')
    async sendSubscriptionExpiryWarnings(): Promise<void> {
        const now = new Date();
        const day1 = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
        const day7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Find subscriptions expiring in ~1 day or ~7 days (within a 2-hour window to avoid duplicate sends)
        const window = 2 * 60 * 60 * 1000;
        const targets = await this.db.tenantSubscription.findMany({
            where: {
                status: { in: ['ACTIVE', 'TRIALING'] },
                OR: [
                    { current_period_end: { gte: new Date(day1.getTime() - window), lte: new Date(day1.getTime() + window) } },
                    { current_period_end: { gte: new Date(day7.getTime() - window), lte: new Date(day7.getTime() + window) } },
                ],
            },
            include: {
                tenant: {
                    include: { owner: true },
                },
            },
        });

        for (const sub of targets) {
            const daysLeft = Math.ceil((sub.current_period_end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            const ownerEmail = sub.tenant.owner?.email;
            if (!ownerEmail) continue;

            try {
                await this.email.sendSubscriptionExpiryWarning(
                    ownerEmail,
                    sub.tenant.name,
                    daysLeft,
                    sub.current_period_end,
                );
                this.logger.log(`Expiry warning sent for tenant ${sub.tenant.id} (${daysLeft}d left)`);
            } catch (err) {
                this.logger.error(`Failed expiry warning for tenant ${sub.tenant.id}: ${err}`);
            }
        }
    }

    // Run daily at 07:00
    @Cron('0 7 * * *')
    async sendLowStockAlerts(): Promise<void> {
        const tenants = await this.db.tenant.findMany({
            include: {
                owner: true,
                inventorySettings: true,
            },
        });

        for (const tenant of tenants) {
            const defaultReorder = tenant.inventorySettings?.default_reorder_level ?? 10;
            const ownerEmail = tenant.owner?.email;
            if (!ownerEmail) continue;

            try {
                // Find products at or below reorder level across all warehouses
                const lowStockItems = await this.db.$queryRaw<
                    Array<{ name: string; sku: string; total_qty: number; reorder_level: number }>
                >`
                    SELECT p.name, p.sku,
                           COALESCE(SUM(ps.quantity), 0) AS total_qty,
                           COALESCE(p.reorder_level, ${defaultReorder}) AS reorder_level
                    FROM "Product" p
                    LEFT JOIN "ProductStock" ps ON ps.product_id = p.id
                    WHERE p.tenant_id = ${tenant.id}
                    GROUP BY p.id, p.name, p.sku, p.reorder_level
                    HAVING COALESCE(SUM(ps.quantity), 0) <= COALESCE(p.reorder_level, ${defaultReorder})
                    ORDER BY total_qty ASC
                    LIMIT 50
                `;

                if (lowStockItems.length === 0) continue;

                await this.email.sendLowStockAlert(
                    ownerEmail,
                    tenant.name,
                    lowStockItems.map((i) => ({
                        name: i.name,
                        sku: i.sku,
                        quantity: Number(i.total_qty),
                        reorderPoint: Number(i.reorder_level),
                    })),
                );
                this.logger.log(`Low stock alert sent for tenant ${tenant.id} (${lowStockItems.length} items)`);
            } catch (err) {
                this.logger.error(`Failed low stock alert for tenant ${tenant.id}: ${err}`);
            }
        }
    }
}
