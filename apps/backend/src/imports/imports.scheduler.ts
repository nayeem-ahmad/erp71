import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { LC_EXPIRY_WARNING_DAYS, ShipmentStatus } from './imports.constants';

/**
 * Midnight-to-midnight in UTC, `days` from now, tagged with the tier it is.
 *
 * The tag matters: the number of days to report is the one that selected the
 * row, not a gap recomputed from `Date.now()`. Recomputing reads the time of
 * day the column happens to hold — midnight for a date typed into a form, noon
 * for one built in a test — and rounds to a different day depending on what
 * time the cron fired.
 */
function dayWindow(days: number): { days: number; gte: Date; lte: Date } {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + days);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCHours(23, 59, 59, 999);
    return { days, gte: start, lte: end };
}

const within = (date: Date | null, window: { gte: Date; lte: Date }) =>
    date !== null && date >= window.gte && date <= window.lte;

@Injectable()
export class ImportsScheduler {
    constructor(
        private readonly db: DatabaseService,
        private readonly logger: AppLogger,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /**
     * Tells someone an LC is about to lapse, while there is still time to act.
     *
     * The LC register colours an expiring row red and amber, which helps
     * exactly the person who thinks to open the LC register. An expired LC is a
     * real loss — the bank's undertaking lapses and the goods may already be on
     * the water — and nothing else in the system watches the date, so the one
     * thing it must not depend on is somebody remembering to look.
     *
     * Fires on two exact days rather than "within N": a range would re-notify
     * every morning for a fortnight and be muted by the second week. Fourteen
     * days is long enough to get an amendment through a bank; three is the last
     * moment anyone can act on it.
     *
     * The same two tiers cover an acceptance maturing, which is the other date
     * here with a bank penalty behind it.
     */
    @Cron('0 7 * * *', { name: 'imports.lc-expiry-alerts' })
    async sendLcExpiryAlerts() {
        return this.jobTracker.track(JOB_NAMES.IMPORTS_LC_EXPIRY, async () => {
            const windows = LC_EXPIRY_WARNING_DAYS.map(dayWindow);

            const shipments = await this.db.importShipment.findMany({
                where: {
                    status: { notIn: [ShipmentStatus.CLOSED, ShipmentStatus.CANCELLED] },
                    OR: [
                        ...windows.map(({ gte, lte }) => ({ lc_expiry_date: { gte, lte } })),
                        ...windows.map(({ gte, lte }) => ({ acceptance_due_date: { gte, lte } })),
                    ],
                },
                select: {
                    id: true,
                    tenant_id: true,
                    reference_number: true,
                    lc_number: true,
                    lc_expiry_date: true,
                    acceptance_due_date: true,
                    tenant: { select: { owner_id: true } },
                },
            });

            const today = Date.now();

            let sent = 0;
            let skipped = 0;

            for (const shipment of shipments) {
                const recipientId = shipment.tenant?.owner_id;
                if (!recipientId) {
                    skipped += 1;
                    continue;
                }

                // The query matched on one of the two dates; find which window,
                // and the tier it carries is the number of days to report.
                const expiryTier = windows.find((window) => within(shipment.lc_expiry_date, window));
                const maturityTier = windows.find((window) => within(shipment.acceptance_due_date, window));
                const tier = expiryTier ?? maturityTier;
                if (!tier) {
                    // Only reachable if the row matched the query and then
                    // failed both checks, which the windows make impossible.
                    skipped += 1;
                    continue;
                }

                const expiring = expiryTier !== undefined;
                const days = tier.days;
                const label = shipment.lc_number ?? shipment.reference_number;

                // One notification per shipment per day. Two tiers can never
                // coincide, but an expiry and a maturity can, and a retry after
                // a partial failure would otherwise duplicate the whole batch.
                const alreadySent = await this.db.notification.findFirst({
                    where: {
                        tenant_id: shipment.tenant_id,
                        user_id: recipientId,
                        type: 'LC_EXPIRY',
                        link: `/purchases/imports/${shipment.id}`,
                        created_at: { gte: new Date(today - 20 * 60 * 60 * 1000) },
                    },
                    select: { id: true },
                });
                if (alreadySent) {
                    skipped += 1;
                    continue;
                }

                try {
                    await this.db.notification.create({
                        data: {
                            tenant_id: shipment.tenant_id,
                            user_id: recipientId,
                            type: 'LC_EXPIRY',
                            title: expiring
                                ? `LC ${label} expires in ${days} day${days === 1 ? '' : 's'}`
                                : `LC ${label} matures in ${days} day${days === 1 ? '' : 's'}`,
                            body: expiring
                                ? `The letter of credit on shipment ${shipment.reference_number} lapses soon. Amend or extend it with the bank before it does.`
                                : `The acceptance on shipment ${shipment.reference_number} falls due soon. Settle it with the bank to avoid a penalty.`,
                            link: `/purchases/imports/${shipment.id}`,
                        },
                    });
                    sent += 1;
                } catch (error) {
                    // One tenant's failure must not cost every other tenant
                    // their warning — the whole point of the job is the ones
                    // that do get through.
                    skipped += 1;
                    this.logger.error(
                        `LC expiry alert failed for shipment ${shipment.reference_number} (${shipment.id})`,
                        error instanceof Error ? error.stack : String(error),
                        'ImportsScheduler',
                    );
                }
            }

            return { shipments: shipments.length, sent, skipped };
        });
    }
}
