import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';

/* ── Report types ─────────────────────────────────────────────────── */

interface DailyRevenue {
    label: string; // e.g. "Mon 12 May"
    amount: number;
}

interface SalesReportData {
    tenantName: string;
    period: string;        // human-readable period string
    from: Date;
    to: Date;
    totalRevenue: number;
    transactionCount: number;
    avgSaleValue: number;
    topProductName: string;
    topProductQty: number;
    newCustomers: number;
    dailyRevenue: DailyRevenue[];  // per-day (weekly) or per-week (monthly)
}

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        private db: DatabaseService,
        private email: EmailService,
        private sms: SmsService,
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
            sms_on_low_stock: boolean;
            product_name: string;
            sku: string;
            total_qty: bigint;
            reorder_level: number;
        }>>`
            SELECT
                t.id                    AS tenant_id,
                t.name                  AS tenant_name,
                u.email                 AS owner_email,
                t.sms_on_low_stock,
                p.name                  AS product_name,
                p.sku,
                COALESCE(SUM(ps.quantity), 0)                           AS total_qty,
                COALESCE(p.reorder_level, COALESCE(inv.default_reorder_level, 10)) AS reorder_level
            FROM "Tenant" t
            JOIN "User" u ON u.id = t.owner_id
            JOIN "Product" p ON p.tenant_id = t.id
            LEFT JOIN "ProductStock" ps ON ps.product_id = p.id
            LEFT JOIN "InventorySettings" inv ON inv.tenant_id = t.id
            GROUP BY t.id, t.name, u.email, t.sms_on_low_stock, p.id, p.name, p.sku, p.reorder_level, inv.default_reorder_level
            HAVING COALESCE(SUM(ps.quantity), 0) <= COALESCE(p.reorder_level, COALESCE(inv.default_reorder_level, 10))
            ORDER BY t.id, total_qty ASC
        `;

        // Group by tenant and send one email per tenant
        const byTenant = new Map<string, {
            name: string;
            email: string;
            smsOnLowStock: boolean;
            items: Array<{ name: string; sku: string; quantity: number; reorderPoint: number }>;
        }>();
        for (const row of rows) {
            if (!byTenant.has(row.tenant_id)) {
                byTenant.set(row.tenant_id, {
                    name: row.tenant_name,
                    email: row.owner_email,
                    smsOnLowStock: row.sms_on_low_stock,
                    items: [],
                });
            }
            byTenant.get(row.tenant_id)!.items.push({
                name: row.product_name,
                sku: row.sku ?? '',
                quantity: Number(row.total_qty),
                reorderPoint: Number(row.reorder_level),
            });
        }

        for (const [tenantId, { name, email, smsOnLowStock, items }] of byTenant) {
            try {
                await this.email.sendLowStockAlert(email, name, items.slice(0, 50));
                this.logger.log(`Low stock alert sent for tenant ${tenantId} (${items.length} items)`);
            } catch (err) {
                this.logger.error(`Failed low stock alert for tenant ${tenantId}: ${err}`);
            }

            // Send SMS low-stock alerts if enabled and the tenant owner has a phone number
            if (smsOnLowStock) {
                const ownerPhone = await this.getTenantOwnerPhone(tenantId);
                if (ownerPhone) {
                    for (const item of items.slice(0, 20)) {
                        try {
                            await this.sms.sendLowStockAlert(ownerPhone, item.name, item.quantity);
                        } catch (err) {
                            this.logger.error(
                                `Failed SMS low stock alert for tenant ${tenantId}, product ${item.name}: ${err}`,
                            );
                        }
                    }
                }
            }
        }
    }

    /**
     * Look up the phone number for the owner of a tenant.
     * Returns null if the owner has no phone on record.
     */
    private async getTenantOwnerPhone(tenantId: string): Promise<string | null> {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { owner: { select: { id: true } } },
        });
        if (!tenant?.owner) return null;
        // User model does not currently have a phone field; return null.
        // When a phone field is added to User, replace this with the actual lookup.
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Sales Report — Weekly (every Monday at 07:00)                      */
    /* ------------------------------------------------------------------ */

    @Cron('0 7 * * 1')
    async sendWeeklyReports(): Promise<void> {
        const tenants = await this.db.tenant.findMany({
            where: { report_weekly_enabled: true },
            include: { owner: true },
        });

        for (const tenant of tenants) {
            try {
                // Last full Mon–Sun window (the week that just ended)
                const now = new Date();
                const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat; today is Mon=1
                const lastMonday = new Date(now);
                lastMonday.setDate(now.getDate() - 7 - ((dayOfWeek + 6) % 7 - 0)); // go back one full week to last Mon
                // Simpler: today is Monday, so last Mon is 7 days ago
                lastMonday.setDate(now.getDate() - 7);
                lastMonday.setHours(0, 0, 0, 0);
                const lastSunday = new Date(lastMonday);
                lastSunday.setDate(lastMonday.getDate() + 6);
                lastSunday.setHours(23, 59, 59, 999);

                const data = await this.generateSalesReport(tenant.id, tenant.name, lastMonday, lastSunday);
                const html = this.buildSalesReportHtml(data);
                const to = tenant.report_email ?? tenant.owner?.email;
                if (!to) continue;
                await this.email['send']({ to, subject: `Weekly Sales Report – ${tenant.name}`, html });
                this.logger.log(`Weekly report sent for tenant ${tenant.id}`);
            } catch (err) {
                this.logger.error(`Failed weekly report for tenant ${tenant.id}: ${err}`);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Sales Report — Monthly (1st of each month at 07:00)               */
    /* ------------------------------------------------------------------ */

    @Cron('0 7 1 * *')
    async sendMonthlyReports(): Promise<void> {
        const tenants = await this.db.tenant.findMany({
            where: { report_monthly_enabled: true },
            include: { owner: true },
        });

        for (const tenant of tenants) {
            try {
                // Previous calendar month
                const now = new Date();
                const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                const firstOfLastMonth = new Date(firstOfThisMonth);
                firstOfLastMonth.setMonth(firstOfThisMonth.getMonth() - 1);
                const lastOfLastMonth = new Date(firstOfThisMonth.getTime() - 1); // one ms before today's first day

                const data = await this.generateSalesReport(tenant.id, tenant.name, firstOfLastMonth, lastOfLastMonth);
                const html = this.buildSalesReportHtml(data);
                const to = tenant.report_email ?? tenant.owner?.email;
                if (!to) continue;
                await this.email['send']({ to, subject: `Monthly Sales Report – ${tenant.name}`, html });
                this.logger.log(`Monthly report sent for tenant ${tenant.id}`);
            } catch (err) {
                this.logger.error(`Failed monthly report for tenant ${tenant.id}: ${err}`);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Private helpers                                                    */
    /* ------------------------------------------------------------------ */

    private async generateSalesReport(
        tenantId: string,
        tenantName: string,
        from: Date,
        to: Date,
    ): Promise<SalesReportData> {
        const sales = await this.db.sale.findMany({
            where: {
                tenant_id: tenantId,
                created_at: { gte: from, lte: to },
                status: 'COMPLETED',
            },
            select: {
                total_amount: true,
                created_at: true,
                customer_id: true,
                items: {
                    select: {
                        quantity: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });

        const totalRevenue = sales.reduce((sum, s) => sum + s.total_amount.toNumber(), 0);
        const transactionCount = sales.length;
        const avgSaleValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;

        // Top product by total quantity sold
        const productQty = new Map<string, number>();
        for (const sale of sales) {
            for (const item of sale.items) {
                const name = item.product?.name ?? 'Unknown';
                productQty.set(name, (productQty.get(name) ?? 0) + item.quantity);
            }
        }
        let topProductName = '—';
        let topProductQty = 0;
        for (const [name, qty] of productQty) {
            if (qty > topProductQty) {
                topProductQty = qty;
                topProductName = name;
            }
        }

        // New customers created within the period
        const newCustomers = await this.db.customer.count({
            where: {
                tenant_id: tenantId,
                created_at: { gte: from, lte: to },
            },
        });

        // Determine period type: if span <= 8 days → weekly (daily bars), else monthly (weekly bars)
        const spanDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        const isWeekly = spanDays <= 8;

        // Build daily/weekly revenue buckets
        const dailyRevenue: DailyRevenue[] = [];
        const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        if (isWeekly) {
            // One bucket per day of the week
            const buckets = new Map<string, number>();
            for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
                const key = d.toISOString().slice(0, 10);
                buckets.set(key, 0);
            }
            for (const sale of sales) {
                const key = sale.created_at.toISOString().slice(0, 10);
                if (buckets.has(key)) buckets.set(key, (buckets.get(key)! + sale.total_amount.toNumber()));
            }
            for (const [key, amount] of buckets) {
                const d = new Date(key + 'T00:00:00Z');
                dailyRevenue.push({ label: `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`, amount });
            }
        } else {
            // One bucket per calendar week within the month
            const weekBuckets = new Map<string, number>();
            const weekLabels = new Map<string, string>();
            for (const sale of sales) {
                const d = sale.created_at;
                // Week number within year as key
                const weekStart = new Date(d);
                weekStart.setDate(d.getDate() - d.getDay());
                const key = weekStart.toISOString().slice(0, 10);
                weekBuckets.set(key, (weekBuckets.get(key) ?? 0) + sale.total_amount.toNumber());
                if (!weekLabels.has(key)) {
                    weekLabels.set(key, `${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]}`);
                }
            }
            // Ensure all weeks in range appear
            const cur = new Date(from);
            cur.setDate(cur.getDate() - cur.getDay()); // align to Sunday
            while (cur <= to) {
                const key = cur.toISOString().slice(0, 10);
                if (!weekBuckets.has(key)) weekBuckets.set(key, 0);
                if (!weekLabels.has(key)) weekLabels.set(key, `${cur.getDate()} ${MONTH_NAMES[cur.getMonth()]}`);
                cur.setDate(cur.getDate() + 7);
            }
            for (const [key, amount] of [...weekBuckets.entries()].sort()) {
                dailyRevenue.push({ label: weekLabels.get(key) ?? key, amount });
            }
        }

        // Human-readable period string
        const fmtDate = (d: Date) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
        const period = `${fmtDate(from)} – ${fmtDate(to)}`;

        return {
            tenantName,
            period,
            from,
            to,
            totalRevenue,
            transactionCount,
            avgSaleValue,
            topProductName,
            topProductQty,
            newCustomers,
            dailyRevenue,
        };
    }

    private buildSalesReportHtml(data: SalesReportData): string {
        const fmt = (n: number) =>
            '৳' + n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const maxAmount = Math.max(...data.dailyRevenue.map((d) => d.amount), 1);

        const barRows = data.dailyRevenue
            .map(({ label, amount }) => {
                const pct = Math.round((amount / maxAmount) * 100);
                return `
            <tr>
                <td style="padding:3px 8px 3px 0;font-size:11px;color:#6b7280;white-space:nowrap;width:90px;">${label}</td>
                <td style="padding:3px 0;width:100%;">
                    <div style="background:#e5e7eb;border-radius:4px;height:16px;width:100%;position:relative;">
                        <div style="background:#2563eb;border-radius:4px;height:16px;width:${pct}%;min-width:${pct > 0 ? '4px' : '0'};"></div>
                    </div>
                </td>
                <td style="padding:3px 0 3px 8px;font-size:11px;color:#374151;white-space:nowrap;text-align:right;">${fmt(amount)}</td>
            </tr>`;
            })
            .join('');

        return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);">

      <!-- Header -->
      <tr>
        <td style="background:#1d4ed8;padding:28px 32px;">
          <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#93c5fd;">Sales Report</p>
          <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#ffffff;">${data.period}</h1>
          <p style="margin:4px 0 0;font-size:13px;color:#bfdbfe;">${data.tenantName}</p>
        </td>
      </tr>

      <!-- Summary table -->
      <tr>
        <td style="padding:28px 32px 0;">
          <h2 style="margin:0 0 14px;font-size:14px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">Summary</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr style="background:#f9fafb;">
              <td style="padding:10px 12px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Total Sales</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#111827;text-align:right;border-bottom:1px solid #e5e7eb;">${fmt(data.totalRevenue)}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Number of Transactions</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#111827;text-align:right;border-bottom:1px solid #e5e7eb;">${data.transactionCount}</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:10px 12px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Average Sale Value</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#111827;text-align:right;border-bottom:1px solid #e5e7eb;">${fmt(data.avgSaleValue)}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Top Product</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#111827;text-align:right;border-bottom:1px solid #e5e7eb;">${data.topProductName} (${data.topProductQty} units)</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:10px 12px;font-size:13px;color:#374151;">New Customers</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#111827;text-align:right;">${data.newCustomers}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Bar chart -->
      <tr>
        <td style="padding:24px 32px 0;">
          <h2 style="margin:0 0 14px;font-size:14px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">Revenue Breakdown</h2>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${barRows}
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:28px 32px;text-align:center;border-top:1px solid #e5e7eb;margin-top:24px;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Powered by <strong style="color:#6b7280;">RetailSaaS</strong></p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
    }

    // #74 Data retention — runs daily at 03:00
    @Cron('0 3 * * *')
    async purgeExpiredData(): Promise<void> {
        const now = new Date();

        // Purge used or expired password reset tokens older than 7 days
        const tokenCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const { count: pwTokens } = await this.db.passwordResetToken.deleteMany({
            where: { OR: [{ used_at: { not: null } }, { expires_at: { lt: tokenCutoff } }] },
        });

        // Purge expired email verification tokens older than 7 days
        const { count: evTokens } = await this.db.emailVerificationToken.deleteMany({
            where: { expires_at: { lt: tokenCutoff } },
        });

        // Purge audit logs older than 90 days (retain 90-day window)
        const auditCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const { count: auditRows } = await this.db.auditLog.deleteMany({
            where: { created_at: { lt: auditCutoff } },
        });

        this.logger.log(
            `[DataRetention] Purged: ${pwTokens} pw-reset tokens, ${evTokens} verification tokens, ${auditRows} audit logs`,
        );
    }
}
