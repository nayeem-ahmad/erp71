import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorePermission } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApproverDirectory } from '../approvals/approver-directory';
import { AnomalyDetectionService } from '../ai/anomaly-detection.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { formatTaka } from '../common/format-taka';
import { startOfZonedToday, zonedDateString } from '../common/tenant-time.util';
import { AlertSettingsService } from './alert-settings.service';

const CURSOR = 'mobile-alerts';
/** Rows younger than this may still belong to a transaction that has not committed. */
const COMMIT_LAG_MS = 60 * 1000;
/** The first scan ever, and the most any scan looks back after downtime. */
const FIRST_LOOKBACK_MS = 10 * 60 * 1000;
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** How the storefront enquiry service writes an enquiry onto its lead. */
export const ENQUIRY_PREFIX = 'Website enquiry from ';

type Alert = {
    tenantId: string;
    storeId: string | null;
    permission: StorePermission;
    /** Not told about what they did themselves. */
    actorId: string | null;
    type: string;
    title: string;
    body: string;
    link: string | null;
    dedupeKey: string;
};

/**
 * Raises the alerts a shop owner wants on their phone from what has just
 * happened: a large sale, a large refund, a cancelled sale, a till that closed
 * short, a website enquiry — and, once a day, the anomaly digest.
 *
 * A scan every five minutes over the rows written since the last one, rather
 * than a hook in each module: a sale, a refund and a till close stay exactly as
 * fast as they were, and an alerting fault can never fail one of them. The
 * cursor makes each row looked at once; the dedupe key makes a row that is
 * looked at twice (a crash between notifying and moving the cursor) alert once.
 */
@Injectable()
export class AlertScannerService {
    private readonly logger = new Logger(AlertScannerService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly notifications: NotificationsService,
        private readonly directory: ApproverDirectory,
        private readonly settings: AlertSettingsService,
        private readonly anomalies: AnomalyDetectionService,
        private readonly timezones: TenantTimezoneService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    @Cron('*/5 * * * *', { timeZone: 'Asia/Dhaka' })
    async scan(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.ALERT_SCAN, () => this.scanOnce());
    }

    async scanOnce(now = new Date()): Promise<number> {
        const to = new Date(now.getTime() - COMMIT_LAG_MS);
        const cursor = await this.db.alertScanCursor.findUnique({ where: { name: CURSOR } });
        const from = new Date(
            Math.max(
                cursor?.scanned_to.getTime() ?? to.getTime() - FIRST_LOOKBACK_MS,
                to.getTime() - MAX_LOOKBACK_MS,
            ),
        );
        if (from >= to) return 0;

        const lowest = await this.settings.lowest();
        const found = (
            await Promise.all([
                this.largeSales(from, to, lowest.large_sale_amount),
                this.cancelledSales(from, to),
                this.largeRefunds(from, to, lowest.large_refund_amount),
                this.shortTills(from, to, lowest.till_shortfall_amount),
                this.enquiries(from, to),
            ])
        ).flat();

        const thresholds = await this.settings.forTenants(found.map((a) => a.alert.tenantId));
        const raised = found
            .filter(({ alert, amount, threshold }) =>
                threshold === null ? true : amount >= thresholds.get(alert.tenantId)![threshold],
            )
            .map(({ alert }) => alert);

        for (const alert of raised) await this.deliver(alert);
        await this.db.alertScanCursor.upsert({
            where: { name: CURSOR },
            create: { name: CURSOR, scanned_to: to },
            update: { scanned_to: to },
        });
        return raised.length;
    }

    private async deliver(alert: Alert): Promise<void> {
        try {
            const recipients = (await this.directory.userIds(alert.tenantId, alert.permission, alert.storeId)).filter(
                (userId) => userId !== alert.actorId,
            );
            for (const userId of recipients) {
                await this.notifications.create(alert.tenantId, userId, alert.type, alert.title, alert.body, alert.link ?? undefined, {
                    dedupeKey: alert.dedupeKey,
                });
            }
        } catch (error) {
            this.logger.warn(`Alert ${alert.dedupeKey} for ${alert.tenantId} failed: ${error}`);
        }
    }

    private async largeSales(from: Date, to: Date, floor: number) {
        const sales = await this.db.sale.findMany({
            where: { status: 'COMPLETED', created_at: { gt: from, lte: to }, total_amount: { gte: floor } },
            select: {
                id: true, tenant_id: true, store_id: true, serial_number: true, total_amount: true, created_by: true,
                store: { select: { name: true } },
                customer: { select: { name: true } },
            },
        });
        return sales.map((sale) => ({
            amount: Number(sale.total_amount),
            threshold: 'large_sale_amount' as const,
            alert: {
                tenantId: sale.tenant_id,
                storeId: sale.store_id,
                permission: StorePermission.VIEW_FINANCIAL_REPORTS,
                actorId: sale.created_by,
                type: 'LARGE_SALE',
                title: `Large sale: ${formatTaka(sale.total_amount as unknown as number)}`,
                body: [sale.serial_number, sale.store?.name, sale.customer?.name ? `to ${sale.customer.name}` : null]
                    .filter(Boolean)
                    .join(' · '),
                link: `/sales/${sale.id}`,
                dedupeKey: `sale:${sale.id}`,
            },
        }));
    }

    private async cancelledSales(from: Date, to: Date) {
        const sales = await this.db.sale.findMany({
            where: { status: 'CANCELLED', cancelled_at: { gt: from, lte: to } },
            select: {
                id: true, tenant_id: true, store_id: true, serial_number: true, total_amount: true,
                cancelled_by: true, cancellation_note: true, store: { select: { name: true } },
            },
        });
        return sales.map((sale) => ({
            amount: Number(sale.total_amount),
            threshold: null,
            alert: {
                tenantId: sale.tenant_id,
                storeId: sale.store_id,
                permission: StorePermission.VIEW_FINANCIAL_REPORTS,
                actorId: sale.cancelled_by,
                type: 'SALE_VOIDED',
                title: `Sale cancelled: ${sale.serial_number}`,
                body: [formatTaka(sale.total_amount as unknown as number), sale.store?.name, sale.cancellation_note]
                    .filter(Boolean)
                    .join(' · '),
                link: `/sales/${sale.id}`,
                dedupeKey: `void:${sale.id}`,
            },
        }));
    }

    private async largeRefunds(from: Date, to: Date, floor: number) {
        const returns = await this.db.salesReturn.findMany({
            where: { status: { not: 'CANCELLED' }, created_at: { gt: from, lte: to }, total_refund: { gte: floor } },
            select: {
                id: true, tenant_id: true, store_id: true, return_number: true, total_refund: true,
                created_by: true, reason: true, store: { select: { name: true } },
            },
        });
        return returns.map((ret) => ({
            amount: Number(ret.total_refund),
            threshold: 'large_refund_amount' as const,
            alert: {
                tenantId: ret.tenant_id,
                storeId: ret.store_id,
                permission: StorePermission.VIEW_FINANCIAL_REPORTS,
                actorId: ret.created_by,
                type: 'LARGE_REFUND',
                title: `Large refund: ${formatTaka(ret.total_refund as unknown as number)}`,
                body: [ret.return_number, ret.store?.name, ret.reason].filter(Boolean).join(' · '),
                link: '/sales/returns',
                dedupeKey: `refund:${ret.id}`,
            },
        }));
    }

    private async shortTills(from: Date, to: Date, floor: number) {
        const sessions = await this.db.cashierSession.findMany({
            where: { status: 'CLOSED', closed_at: { gt: from, lte: to }, variance: { lte: -floor } },
            select: {
                id: true, tenant_id: true, store_id: true, user_id: true, variance: true,
                closing_cash: true, expected_cash: true,
                user: { select: { name: true } },
                counter: { select: { name: true } },
                store: { select: { name: true } },
            },
        });
        return sessions.map((session) => {
            const short = -Number(session.variance);
            return {
                amount: short,
                threshold: 'till_shortfall_amount' as const,
                alert: {
                    tenantId: session.tenant_id,
                    storeId: session.store_id,
                    permission: StorePermission.VIEW_FINANCIAL_REPORTS,
                    actorId: session.user_id,
                    type: 'TILL_SHORTFALL',
                    title: `Till closed ${formatTaka(short)} short`,
                    body: `${[session.user?.name, session.counter?.name, session.store?.name].filter(Boolean).join(' · ')}: counted ${formatTaka(
                        session.closing_cash as unknown as number,
                    )} against ${formatTaka(session.expected_cash as unknown as number)}`,
                    link: '/sales/cashier-sessions',
                    dedupeKey: `till:${session.id}`,
                },
            };
        });
    }

    private async enquiries(from: Date, to: Date) {
        const rows = await this.db.leadConversation.findMany({
            where: {
                direction: 'INBOUND',
                created_by: null,
                summary: { startsWith: ENQUIRY_PREFIX },
                created_at: { gt: from, lte: to },
            },
            select: { id: true, tenant_id: true, lead_id: true, summary: true },
        });
        return rows.map((row) => {
            const text = (row.summary ?? '').slice(ENQUIRY_PREFIX.length).replace(/\s+/g, ' ').trim();
            return {
                amount: 0,
                threshold: null,
                alert: {
                    tenantId: row.tenant_id,
                    storeId: null,
                    permission: StorePermission.VIEW_LEADS,
                    actorId: null,
                    type: 'ENQUIRY',
                    title: 'New website enquiry',
                    body: text.length > 140 ? `${text.slice(0, 139)}…` : text,
                    link: `/crm/leads/${row.lead_id}`,
                    dedupeKey: `enquiry:${row.id}`,
                },
            };
        });
    }

    /**
     * Once a day: what the anomaly detector found in today's sales and
     * purchases, as one notification per manager rather than one per finding.
     */
    @Cron('30 20 * * *', { timeZone: 'Asia/Dhaka' })
    async dailyAnomalyDigest(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.ANOMALY_DIGEST, () => this.anomalyDigestOnce());
    }

    async anomalyDigestOnce(now = new Date()): Promise<number> {
        // Only workspaces that sold something since yesterday this time.
        const active = await this.db.sale.groupBy({
            by: ['tenant_id'],
            where: { created_at: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
        });
        let sent = 0;
        for (const { tenant_id: tenantId } of active) {
            try {
                const timeZone = await this.timezones.for(tenantId);
                const today = zonedDateString(startOfZonedToday(timeZone, now), timeZone);
                const result = await this.anomalies.scan(tenantId, { from: today, to: today, sensitivity: 'normal' });
                if (result.totalFlags === 0) continue;

                const top = result.anomalies.slice(0, 2).map((a) => a.detail);
                const count = result.totalFlags;
                await this.deliver({
                    tenantId,
                    storeId: null,
                    permission: StorePermission.VIEW_FINANCIAL_REPORTS,
                    actorId: null,
                    type: 'ANOMALY_DIGEST',
                    title: `${count} ${count === 1 ? 'thing' : 'things'} looked unusual today`,
                    body: top.join(' · ') + (count > top.length ? ` · and ${count - top.length} more` : ''),
                    link: null,
                    dedupeKey: `anomaly:${today}`,
                });
                sent++;
            } catch (error) {
                this.logger.warn(`Anomaly digest for ${tenantId} failed: ${error}`);
            }
        }
        return sent;
    }
}
