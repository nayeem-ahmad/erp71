import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { smsDestination } from '../sms/sms-destination';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { dailySummaryReportDate } from './daily-summary-clock';
import { formatDailySummaryEmail, type SummaryBranch } from './daily-summary-email.format';
import { DailyReportService } from './daily-report.service';

const LOCK_MS = 10 * 60 * 1000;

type SummaryTenant = {
    id: string;
    name: string;
    timezone: string;
    default_locale: string;
    daily_summary_recipient_ids: string[];
    owner: { id: string; name: string | null; mobile: string | null } | null;
};

type Recipient = { phone: string; name: string | null };

@Injectable()
export class DailySummaryWhatsAppService {
    private readonly logger = new Logger(DailySummaryWhatsAppService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly reports: DailyReportService,
        private readonly email: EmailService,
        private readonly whatsapp: WhatsAppService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /** Every 15 minutes. Each shop is messaged once, at 00:20 in its own timezone. */
    @Cron('*/15 * * * *', { timeZone: 'Asia/Dhaka' })
    async sendDailySummaryWhatsApp(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.DAILY_SUMMARY_WHATSAPP, () => this.sendDue(new Date()));
    }

    async sendDue(now: Date): Promise<void> {
        const tenants = await this.db.tenant.findMany({
            where: { daily_summary_whatsapp_enabled: true, deleted_at: null },
            select: {
                id: true,
                name: true,
                timezone: true,
                default_locale: true,
                daily_summary_recipient_ids: true,
                owner: { select: { id: true, name: true, mobile: true } },
            },
        });

        for (const tenant of tenants) {
            try {
                await this.sendTenant(tenant, now);
            } catch (err) {
                this.logger.error(`Daily summary WhatsApp failed for tenant ${tenant.id}: ${err}`);
            }
        }
    }

    private async sendTenant(tenant: SummaryTenant, now: Date): Promise<void> {
        const reportDate = dailySummaryReportDate(now, tenant.timezone);
        if (!reportDate) return;

        const key = { tenant_id: tenant.id, report_date: reportDate };
        await this.db.dailySummaryWhatsAppSend.upsert({
            where: { tenant_id_report_date: key },
            create: key,
            update: {},
        });

        const row = await this.db.dailySummaryWhatsAppSend.findUnique({
            where: { tenant_id_report_date: key },
        });
        if (!row || row.completed_at) return;

        const claim = await this.db.dailySummaryWhatsAppSend.updateMany({
            where: {
                ...key,
                completed_at: null,
                OR: [{ locked_until: null }, { locked_until: { lt: now } }],
            },
            data: { locked_until: new Date(now.getTime() + LOCK_MS) },
        });
        if (claim.count === 0) return;

        try {
            const message = await this.build(tenant, reportDate, now);
            const recipients = await this.recipients(tenant);
            if (!message || recipients.length === 0) {
                await this.complete(key, row.sent_to);
                return;
            }

            const sent = new Set(row.sent_to);
            let retry = false;
            for (const recipient of recipients) {
                if (sent.has(recipient.phone)) continue;
                const result = await this.whatsapp.sendOwnerDailySummary(
                    recipient.phone,
                    { name: recipient.name, day: message.day, summary: message.summary },
                    { tenantId: tenant.id },
                );
                if (result.sent) {
                    sent.add(recipient.phone);
                    await this.db.dailySummaryWhatsAppSend.update({
                        where: { tenant_id_report_date: key },
                        data: { sent_to: [...sent] },
                    });
                    continue;
                }
                if (result.reason === 'INSUFFICIENT_WHATSAPP_CREDITS') {
                    retry = true;
                    this.logger.error(`Daily summary WhatsApp to ${recipient.phone} for tenant ${tenant.id} failed: ${result.reason}`);
                    continue;
                }
                // Meta already charged the credit for a rejection, including while
                // the owner template is still in review. Trying again would charge
                // another credit, so this number waits for the next shop day.
                sent.add(recipient.phone);
                await this.db.dailySummaryWhatsAppSend.update({
                    where: { tenant_id_report_date: key },
                    data: { sent_to: [...sent] },
                });
                this.logger.error(
                    `Daily summary WhatsApp to ${recipient.phone} for tenant ${tenant.id} was rejected: ${result.error ?? result.reason}`,
                );
            }

            if (retry) await this.unlock(key);
            else await this.complete(key, [...sent]);
        } catch (err) {
            await this.unlock(key);
            throw err;
        }
    }

    private async build(tenant: SummaryTenant, reportDate: string, now: Date) {
        const stores = await this.db.store.findMany({
            where: { tenant_id: tenant.id },
            select: { id: true, name: true },
        });
        if (stores.length === 0) return null;

        const branches: SummaryBranch[] = [];
        for (const store of stores) {
            const report = await this.reports.getReport({
                tenantId: tenant.id,
                storeId: store.id,
                tenantName: tenant.name,
                storeName: store.name,
                date: reportDate,
                timezone: tenant.timezone,
                locale: tenant.default_locale,
                now,
            });
            branches.push({ storeId: store.id, storeName: store.name, report });
        }

        const content = formatDailySummaryEmail({
            tenantName: tenant.name,
            date: reportDate,
            timezone: tenant.timezone,
            locale: tenant.default_locale,
            asOf: now.toISOString(),
            branches,
            reportBaseUrl: await this.email.getFrontendUrl(),
        });
        return { day: this.formatDay(reportDate, tenant.timezone), summary: content.text };
    }

    /** Owner first, then the same extra people as the email. A login without a mobile is skipped. */
    private async recipients(tenant: SummaryTenant): Promise<Recipient[]> {
        const people: Recipient[] = [];
        const seen = new Set<string>();
        const add = (mobile: string | null | undefined, name: string | null | undefined) => {
            const phone = smsDestination(mobile);
            if (!phone || seen.has(phone)) return;
            seen.add(phone);
            people.push({ phone, name: name?.trim() || null });
        };

        add(tenant.owner?.mobile, tenant.owner?.name);
        if (tenant.daily_summary_recipient_ids.length === 0) return people;

        const members = await this.db.tenantUser.findMany({
            where: { tenant_id: tenant.id, user_id: { in: tenant.daily_summary_recipient_ids } },
            select: { user: { select: { name: true, mobile: true } } },
        });
        for (const member of members) add(member.user.mobile, member.user.name);
        return people;
    }

    private formatDay(date: string, timeZone: string): string {
        const parsed = new Date(`${date}T12:00:00.000Z`);
        if (Number.isNaN(parsed.getTime())) return date;
        return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(parsed);
    }

    private async complete(key: { tenant_id: string; report_date: string }, sentTo: string[]): Promise<void> {
        await this.db.dailySummaryWhatsAppSend.update({
            where: { tenant_id_report_date: key },
            data: { sent_to: sentTo, completed_at: new Date(), locked_until: null },
        });
    }

    private async unlock(key: { tenant_id: string; report_date: string }): Promise<void> {
        await this.db.dailySummaryWhatsAppSend.update({
            where: { tenant_id_report_date: key },
            data: { locked_until: null },
        });
    }
}
