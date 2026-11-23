import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CHEQUE_REMINDER_DAYS, OPEN_CHEQUE_STATUSES } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { addCalendarDays, zonedDateString } from '../common/tenant-time.util';
import { calendarDay } from './cheques.service';

const TAKA = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** The words a reminder says, kept apart from the query so they can be tested. */
export function chequeReminderText(
    cheque: { direction: string; party_name: string; cheque_number: string; bank_name: string; amount: unknown },
    daysLeft: number,
): { title: string; body: string } {
    const amount = `Tk ${TAKA.format(Number(cheque.amount))}`;
    const when = daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    if (cheque.direction === 'RECEIVED') {
        return {
            title: `Cheque from ${cheque.party_name} can be deposited ${when}`,
            body: `${cheque.bank_name} cheque ${cheque.cheque_number} for ${amount} is dated ${when === 'today' ? 'today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} from now`}. Deposit it on time.`,
        };
    }
    return {
        title: `Cheque to ${cheque.party_name} falls due ${when}`,
        body: `${cheque.bank_name} cheque ${cheque.cheque_number} for ${amount} can be presented ${when}. Make sure the account holds enough.`,
    };
}

/**
 * Tells someone a post-dated cheque is about to fall due. An issued cheque
 * that bounces is a criminal matter in Bangladesh (Negotiable Instruments
 * Act §138), and a received one deposited late can go stale — the register
 * shows the date, but nothing else watches it.
 *
 * Fires on the exact days in `CHEQUE_REMINDER_DAYS`, like the LC alerts, so
 * a cheque is mentioned twice rather than every morning for a week. The
 * person who entered it and the workspace owner hear about it.
 */
@Injectable()
export class ChequesScheduler {
    private readonly logger = new Logger(ChequesScheduler.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly notifications: NotificationsService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    @Cron('0 9 * * *', { timeZone: 'Asia/Dhaka' })
    async sendDueReminders() {
        await this.jobTracker.track(JOB_NAMES.CHEQUE_DUE_REMINDERS, () => this.run());
    }

    async run(now: Date = new Date()) {
        const today = zonedDateString(now, 'Asia/Dhaka');
        const windows = CHEQUE_REMINDER_DAYS.map((days) => ({ days, date: calendarDay(addCalendarDays(today, days)) }));

        const cheques = await this.db.cheque.findMany({
            where: {
                status: { in: [...OPEN_CHEQUE_STATUSES] },
                cheque_date: { in: windows.map((window) => window.date) },
            },
            include: { tenant: { select: { owner_id: true } } },
        });

        let sent = 0;
        let failed = 0;
        for (const cheque of cheques) {
            const window = windows.find((w) => w.date.getTime() === cheque.cheque_date.getTime());
            if (!window) continue;
            const { title, body } = chequeReminderText(cheque, window.days);
            const recipients = [...new Set([cheque.created_by, cheque.tenant?.owner_id].filter((id): id is string => !!id))];
            for (const userId of recipients) {
                // One reminder per cheque per tier, however often the job is
                // retried: the notification policy only collapses repeats
                // within minutes, so the key is checked here for good.
                const dedupeKey = `cheque:${cheque.id}:${cheque.cheque_date.toISOString().slice(0, 10)}:${window.days}`;
                const already = await this.db.notification.findFirst({
                    where: { tenant_id: cheque.tenant_id, user_id: userId, type: 'CHEQUE_DUE', dedupe_key: dedupeKey },
                    select: { id: true },
                });
                if (already) continue;
                try {
                    await this.notifications.create(cheque.tenant_id, userId, 'CHEQUE_DUE', title, body, '/tools/cheques', {
                        dedupeKey,
                    });
                    sent += 1;
                } catch (error) {
                    failed += 1;
                    this.logger.error(`Cheque reminder failed for ${cheque.id}: ${error instanceof Error ? error.message : error}`);
                }
            }
        }
        return { cheques: cheques.length, sent, failed };
    }
}
