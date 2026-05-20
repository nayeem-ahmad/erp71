import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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

        // Warning tiers: subscriptions expiring within [0,2) days (1-day) or [6,8) days (7-day)
        // Using day-based floor/ceil so any expiry time during that day is caught regardless of hour
        const startOf = (daysFromNow: number) => {
            const d = new Date(now);
            d.setDate(d.getDate() + daysFromNow);
            d.setHours(0, 0, 0, 0);
            return d;
        };
        const endOf = (daysFromNow: number) => {
            const d = new Date(now);
            d.setDate(d.getDate() + daysFromNow);
            d.setHours(23, 59, 59, 999);
            return d;
        };

        const targets = await this.db.tenantSubscription.findMany({
            where: {
                status: { in: ['ACTIVE', 'TRIALING'] },
                OR: [
                    { current_period_end: { gte: startOf(1), lte: endOf(1) } },   // 1-day warning
                    { current_period_end: { gte: startOf(7), lte: endOf(7) } },   // 7-day warning
                ],
            },
            include: { tenant: { include: { owner: true } } },
        });

        for (const sub of targets) {
            const daysLeft = Math.ceil((sub.current_period_end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            const ownerEmail = sub.tenant.owner?.email;
            if (!ownerEmail) continue;
            try {
                await this.email.sendSubscriptionExpiryWarning(ownerEmail, sub.tenant.name, daysLeft, sub.current_period_end);
                this.logger.log(`Expiry warning sent for tenant ${sub.tenant_id} (${daysLeft}d left)`);
            } catch (err) {
                this.logger.error(`Failed expiry warning for tenant ${sub.tenant_id}: ${err}`);
            }
        }
    }

    // Run daily at 07:00
    @Cron('0 7 * * *')
    async sendLowStockAlerts(): Promise<void> {
        // Single query: aggregate stock per product across all tenants, join tenant owners
        const rows = await this.db.$queryRaw<Array<{
            tenant_id: string;
            tenant_name: string;
            owner_email: string;
            product_name: string;
            sku: string;
            total_qty: bigint;
            reorder_level: number;
        }>>`
            SELECT
                t.id           AS tenant_id,
                t.name         AS tenant_name,
                u.email        AS owner_email,
                p.name         AS product_name,
                p.sku,
                COALESCE(SUM(ps.quantity), 0)                           AS total_qty,
                COALESCE(p.reorder_level, COALESCE(inv.default_reorder_level, 10)) AS reorder_level
            FROM "Tenant" t
            JOIN "User" u ON u.id = t.owner_id
            JOIN "Product" p ON p.tenant_id = t.id
            LEFT JOIN "ProductStock" ps ON ps.product_id = p.id
            LEFT JOIN "InventorySettings" inv ON inv.tenant_id = t.id
            GROUP BY t.id, t.name, u.email, p.id, p.name, p.sku, p.reorder_level, inv.default_reorder_level
            HAVING COALESCE(SUM(ps.quantity), 0) <= COALESCE(p.reorder_level, COALESCE(inv.default_reorder_level, 10))
            ORDER BY t.id, total_qty ASC
        `;

        // Group by tenant and send one email per tenant
        const byTenant = new Map<string, { name: string; email: string; items: Array<{ name: string; sku: string; quantity: number; reorderPoint: number }> }>();
        for (const row of rows) {
            if (!byTenant.has(row.tenant_id)) {
                byTenant.set(row.tenant_id, { name: row.tenant_name, email: row.owner_email, items: [] });
            }
            byTenant.get(row.tenant_id)!.items.push({
                name: row.product_name,
                sku: row.sku ?? '',
                quantity: Number(row.total_qty),
                reorderPoint: Number(row.reorder_level),
            });
        }

        for (const [tenantId, { name, email, items }] of byTenant) {
            try {
                await this.email.sendLowStockAlert(email, name, items.slice(0, 50));
                this.logger.log(`Low stock alert sent for tenant ${tenantId} (${items.length} items)`);
            } catch (err) {
                this.logger.error(`Failed low stock alert for tenant ${tenantId}: ${err}`);
            }
        }
    }
}
