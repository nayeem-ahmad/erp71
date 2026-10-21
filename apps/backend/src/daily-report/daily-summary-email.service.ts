import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
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
    owner: { id: string; email: string } | null;
};

function cleanEmail(value: string | null | undefined): string | null {
    const email = value?.trim().toLowerCase();
    return email ? email : null;
}

@Injectable()
export class DailySummaryEmailService {
    private readonly logger = new Logger(DailySummaryEmailService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly reports: DailyReportService,
        private readonly email: EmailService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /** Every 15 minutes. Each shop is sent once, at 00:20 in its own timezone. */
    @Cron('*/15 * * * *', { timeZone: 'Asia/Dhaka' })
    async sendDailySummaries(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.DAILY_SUMMARY_EMAIL, () => this.sendDue(new Date()));
    }

    async sendDue(now: Date): Promise<void> {
        const tenants = await this.db.tenant.findMany({
            where: { daily_summary_email_enabled: true, deleted_at: null },
            select: {
                id: true,
                name: true,
                timezone: true,
                default_locale: true,
                daily_summary_recipient_ids: true,
                owner: { select: { id: true, email: true } },
            },
        });

        for (const tenant of tenants) {
            try {
                await this.sendTenant(tenant, now);
            } catch (err) {
                this.logger.error(`Daily summary failed for tenant ${tenant.id}: ${err}`);
            }
        }
    }

    private async sendTenant(tenant: SummaryTenant, now: Date): Promise<void> {
        const reportDate = dailySummaryReportDate(now, tenant.timezone);
        if (!reportDate) return;

        const key = { tenant_id: tenant.id, report_date: reportDate };
        await this.db.dailySummaryEmailSend.upsert({
            where: { tenant_id_report_date: key },
            create: key,
            update: {},
        });

        const row = await this.db.dailySummaryEmailSend.findUnique({
            where: { tenant_id_report_date: key },
        });
        if (!row || row.completed_at) return;

        const claim = await this.db.dailySummaryEmailSend.updateMany({
            where: {
                ...key,
                completed_at: null,
                OR: [{ locked_until: null }, { locked_until: { lt: now } }],
            },
            data: { locked_until: new Date(now.getTime() + LOCK_MS) },
        });
        if (claim.count === 0) return;

        try {
            const content = await this.build(tenant, reportDate, now);
            const recipients = await this.recipients(tenant);
            if (!content || recipients.length === 0) {
                await this.complete(key, row.sent_to);
                return;
            }

            const sent = new Set(row.sent_to.map((address) => address.toLowerCase()));
            let failed = false;
            for (const address of recipients) {
                if (sent.has(address)) continue;
                try {
                    await this.email.sendDailyBusinessSummary(address, content.subject, content.html);
                    sent.add(address);
                    await this.db.dailySummaryEmailSend.update({
                        where: { tenant_id_report_date: key },
                        data: { sent_to: [...sent] },
                    });
                } catch (err) {
                    failed = true;
                    this.logger.error(`Daily summary to ${address} for tenant ${tenant.id} failed: ${err}`);
                }
            }

            if (failed) await this.unlock(key);
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

        const baseUrl = await this.email.getFrontendUrl();
        return formatDailySummaryEmail({
            tenantName: tenant.name,
            date: reportDate,
            timezone: tenant.timezone,
            locale: tenant.default_locale,
            asOf: now.toISOString(),
            branches,
            reportBaseUrl: baseUrl,
        });
    }

    private async recipients(tenant: SummaryTenant): Promise<string[]> {
        const emails: string[] = [];
        const seen = new Set<string>();
        const add = (value: string | null | undefined) => {
            const email = cleanEmail(value);
            if (!email || seen.has(email)) return;
            seen.add(email);
            emails.push(email);
        };

        add(tenant.owner?.email);
        if (tenant.daily_summary_recipient_ids.length === 0) return emails;

        const members = await this.db.tenantUser.findMany({
            where: { tenant_id: tenant.id, user_id: { in: tenant.daily_summary_recipient_ids } },
            select: { user: { select: { email: true } } },
        });
        for (const member of members) add(member.user.email);
        return emails;
    }

    private async complete(key: { tenant_id: string; report_date: string }, sentTo: string[]): Promise<void> {
        await this.db.dailySummaryEmailSend.update({
            where: { tenant_id_report_date: key },
            data: { sent_to: sentTo, completed_at: new Date(), locked_until: null },
        });
    }

    private async unlock(key: { tenant_id: string; report_date: string }): Promise<void> {
        await this.db.dailySummaryEmailSend.update({
            where: { tenant_id_report_date: key },
            data: { locked_until: null },
        });
    }
}
