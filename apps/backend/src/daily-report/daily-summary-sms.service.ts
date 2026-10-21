import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { smsDestination } from '../sms/sms-destination';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { dailySummaryReportDate } from './daily-summary-clock';
import type { SummaryBranch } from './daily-summary-email.format';
import { formatDailySummarySms } from './daily-summary-sms.format';
import { DailyReportService } from './daily-report.service';

const LOCK_MS = 10 * 60 * 1000;

type SummaryTenant = {
    id: string;
    name: string;
    timezone: string;
    default_locale: string;
    daily_summary_recipient_ids: string[];
    owner: { id: string; mobile: string | null } | null;
};

@Injectable()
export class DailySummarySmsService {
    private readonly logger = new Logger(DailySummarySmsService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly reports: DailyReportService,
        private readonly sms: SmsService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /** Every 15 minutes. Each shop is texted once, at 00:20 in its own timezone. */
    @Cron('*/15 * * * *', { timeZone: 'Asia/Dhaka' })
    async sendDailySummaryTexts(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.DAILY_SUMMARY_SMS, () => this.sendDue(new Date()));
    }

    async sendDue(now: Date): Promise<void> {
        const tenants = await this.db.tenant.findMany({
            where: { daily_summary_sms_enabled: true, deleted_at: null },
            select: {
                id: true,
                name: true,
                timezone: true,
                default_locale: true,
                daily_summary_recipient_ids: true,
                owner: { select: { id: true, mobile: true } },
            },
        });

        for (const tenant of tenants) {
            try {
                await this.sendTenant(tenant, now);
            } catch (err) {
                this.logger.error(`Daily summary SMS failed for tenant ${tenant.id}: ${err}`);
            }
        }
    }

    private async sendTenant(tenant: SummaryTenant, now: Date): Promise<void> {
        const reportDate = dailySummaryReportDate(now, tenant.timezone);
        if (!reportDate) return;

        const key = { tenant_id: tenant.id, report_date: reportDate };
        await this.db.dailySummarySmsSend.upsert({
            where: { tenant_id_report_date: key },
            create: key,
            update: {},
        });

        const row = await this.db.dailySummarySmsSend.findUnique({
            where: { tenant_id_report_date: key },
        });
        if (!row || row.completed_at) return;

        const claim = await this.db.dailySummarySmsSend.updateMany({
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
            let failed = false;
            for (const phone of recipients) {
                if (sent.has(phone)) continue;
                const result = await this.sms.sendSms(phone, message, {
                    tenantId: tenant.id,
                    purpose: 'Daily business summary',
                });
                if (!result.sent) {
                    failed = true;
                    this.logger.error(
                        `Daily summary SMS to ${phone} for tenant ${tenant.id} failed: ${result.reason ?? 'not sent'}`,
                    );
                    continue;
                }
                sent.add(phone);
                await this.db.dailySummarySmsSend.update({
                    where: { tenant_id_report_date: key },
                    data: { sent_to: [...sent] },
                });
            }

            if (failed) await this.unlock(key);
            else await this.complete(key, [...sent]);
        } catch (err) {
            await this.unlock(key);
            throw err;
        }
    }

    private async build(tenant: SummaryTenant, reportDate: string, now: Date): Promise<string | null> {
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

        return formatDailySummarySms({
            tenantName: tenant.name,
            date: reportDate,
            timezone: tenant.timezone,
            locale: tenant.default_locale,
            branches,
        });
    }

    /** Owner first, then the same extra people as the email. A login without a mobile is skipped. */
    private async recipients(tenant: SummaryTenant): Promise<string[]> {
        const phones: string[] = [];
        const seen = new Set<string>();
        const add = (mobile: string | null | undefined) => {
            const phone = smsDestination(mobile);
            if (!phone || seen.has(phone)) return;
            seen.add(phone);
            phones.push(phone);
        };

        add(tenant.owner?.mobile);
        if (tenant.daily_summary_recipient_ids.length === 0) return phones;

        const members = await this.db.tenantUser.findMany({
            where: { tenant_id: tenant.id, user_id: { in: tenant.daily_summary_recipient_ids } },
            select: { user: { select: { mobile: true } } },
        });
        for (const member of members) add(member.user.mobile);
        return phones;
    }

    private async complete(key: { tenant_id: string; report_date: string }, sentTo: string[]): Promise<void> {
        await this.db.dailySummarySmsSend.update({
            where: { tenant_id_report_date: key },
            data: { sent_to: sentTo, completed_at: new Date(), locked_until: null },
        });
    }

    private async unlock(key: { tenant_id: string; report_date: string }): Promise<void> {
        await this.db.dailySummarySmsSend.update({
            where: { tenant_id_report_date: key },
            data: { locked_until: null },
        });
    }
}
