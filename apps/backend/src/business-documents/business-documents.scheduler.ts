import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BUSINESS_DOCUMENT_REMINDER_DAYS } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { zonedDateString } from '../common/tenant-time.util';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `today` (a `YYYY-MM-DD`) to a `DATE` column's UTC midnight. */
export function daysUntil(expiry: Date, today: string): number {
    return Math.round((expiry.getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) / DAY_MS);
}

/**
 * Whether today is one of the document's reminder days: its own lead time,
 * then a week, a day, and the day itself.
 */
export function isDocumentReminderDay(daysLeft: number, remindDaysBefore: number): boolean {
    return daysLeft === remindDaysBefore || (BUSINESS_DOCUMENT_REMINDER_DAYS as readonly number[]).includes(daysLeft);
}

export function documentReminderText(doc: { title: string; number: string | null }, daysLeft: number) {
    const label = doc.number ? `${doc.title} (${doc.number})` : doc.title;
    if (daysLeft === 0) {
        return { title: `${doc.title} expires today`, body: `${label} runs out today. Renew it, then update its expiry date under Tools → Documents.` };
    }
    return {
        title: `${doc.title} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        body: `${label} runs out soon. Start the renewal now, then update its expiry date under Tools → Documents.`,
    };
}

/**
 * Tells the owner a licence is about to lapse. A trade licence lapsed in July
 * is a fine at the city corporation and, for an importer, a stopped IRC —
 * and the certificate is in a drawer, where nobody sees its date.
 */
@Injectable()
export class BusinessDocumentsScheduler {
    private readonly logger = new Logger(BusinessDocumentsScheduler.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly notifications: NotificationsService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    @Cron('5 9 * * *', { timeZone: 'Asia/Dhaka' })
    async sendExpiryReminders() {
        await this.jobTracker.track(JOB_NAMES.BUSINESS_DOCUMENT_EXPIRY, () => this.run());
    }

    async run(now: Date = new Date()) {
        const today = zonedDateString(now, 'Asia/Dhaka');
        const start = new Date(`${today}T00:00:00.000Z`);
        // The longest lead time a document may set is 365 days.
        const end = new Date(start.getTime() + 366 * DAY_MS);

        const docs = await this.db.businessDocument.findMany({
            where: { expiry_date: { gte: start, lte: end } },
            include: { tenant: { select: { owner_id: true } } },
        });

        let sent = 0;
        let failed = 0;
        for (const doc of docs) {
            if (!doc.expiry_date) continue;
            const daysLeft = daysUntil(doc.expiry_date, today);
            if (!isDocumentReminderDay(daysLeft, doc.remind_days_before)) continue;

            const { title, body } = documentReminderText(doc, daysLeft);
            const dedupeKey = `document:${doc.id}:${doc.expiry_date.toISOString().slice(0, 10)}:${daysLeft}`;
            const recipients = [...new Set([doc.tenant?.owner_id, doc.created_by].filter((id): id is string => !!id))];
            for (const userId of recipients) {
                const already = await this.db.notification.findFirst({
                    where: { tenant_id: doc.tenant_id, user_id: userId, type: 'DOCUMENT_EXPIRY', dedupe_key: dedupeKey },
                    select: { id: true },
                });
                if (already) continue;
                try {
                    await this.notifications.create(doc.tenant_id, userId, 'DOCUMENT_EXPIRY', title, body, '/tools/documents', { dedupeKey });
                    sent += 1;
                } catch (error) {
                    failed += 1;
                    this.logger.error(`Document reminder failed for ${doc.id}: ${error instanceof Error ? error.message : error}`);
                }
            }
        }
        return { documents: docs.length, sent, failed };
    }
}
