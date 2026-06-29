import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { CheckResult, SystemHealthReport } from '@erp71/shared-types';
import { EmailService } from '../../email/email.service';
import { SmsService } from '../../sms/sms.service';
import { SystemHealthService } from '../system-health.service';
import { JobTrackerService } from '../jobs/job-tracker.service';
import { JOB_NAMES } from '../jobs/job-names';

/**
 * Periodically evaluates the system-health report and notifies platform admins
 * when the system is degraded or down. Sends at most one alert per cooldown
 * window while unhealthy, and a single recovery notice when it returns to ok.
 *
 * Recipients: `HEALTH_ALERT_EMAILS` (comma-separated). Optional SMS to
 * `HEALTH_ALERT_SMS`. Cooldown: `HEALTH_ALERT_COOLDOWN_MIN` (default 30).
 */
@Injectable()
export class HealthAlertService {
    private readonly logger = new Logger(HealthAlertService.name);

    /** Timestamp of the last alert sent in the current unhealthy episode. */
    private lastAlertAt: number | null = null;
    /** Whether we are currently in an alerted (unhealthy) episode. */
    private alerting = false;

    constructor(
        private readonly systemHealth: SystemHealthService,
        private readonly email: EmailService,
        private readonly sms: SmsService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    private get emailRecipients(): string[] {
        return (process.env.HEALTH_ALERT_EMAILS ?? '')
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean);
    }

    private get smsRecipients(): string[] {
        return (process.env.HEALTH_ALERT_SMS ?? '')
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
    }

    private get cooldownMs(): number {
        return parseInt(process.env.HEALTH_ALERT_COOLDOWN_MIN ?? '30', 10) * 60 * 1000;
    }

    @Cron('*/5 * * * *')
    async evaluate(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.HEALTH_ALERTS, () => this.evaluateImpl());
    }

    async evaluateImpl(): Promise<void> {
        const report = await this.systemHealth.getReport();

        if (report.status === 'ok') {
            if (this.alerting) {
                this.alerting = false;
                this.lastAlertAt = null;
                await this.sendRecovery(report);
            }
            return;
        }

        // Unhealthy: alert on the first detection, then re-alert once per cooldown.
        const now = Date.now();
        if (this.lastAlertAt !== null && now - this.lastAlertAt < this.cooldownMs) {
            return;
        }

        this.alerting = true;
        this.lastAlertAt = now;
        await this.sendAlert(report);
    }

    private problemChecks(report: SystemHealthReport): CheckResult[] {
        return report.checks.filter((c) => c.state === 'down' || c.state === 'degraded' || c.state === 'unknown');
    }

    private async sendAlert(report: SystemHealthReport): Promise<void> {
        const problems = this.problemChecks(report);
        const summary = problems.map((c) => `${c.label}: ${c.state}${c.message ? ` — ${c.message}` : ''}`);
        const subject = `[ERP71] System ${report.status.toUpperCase()} — ${problems.length} issue(s)`;

        if (this.emailRecipients.length === 0 && this.smsRecipients.length === 0) {
            this.logger.warn(`System ${report.status}: ${summary.join('; ')} (no alert recipients configured)`);
            return;
        }

        this.logger.error(`System ${report.status}: ${summary.join('; ')}`);

        const html = `
            <h2>System health: ${report.status.toUpperCase()}</h2>
            <p>Detected at ${report.generated_at}.</p>
            <ul>${problems.map((c) => `<li><strong>${c.label}</strong>: ${c.state}${c.message ? ` — ${c.message}` : ''}</li>`).join('')}</ul>
            <p>This alert repeats at most every ${this.cooldownMs / 60000} minutes while unhealthy.</p>
        `;

        await this.dispatch(subject, html, `ERP71 ${report.status}: ${summary.slice(0, 2).join('; ')}`);
    }

    private async sendRecovery(report: SystemHealthReport): Promise<void> {
        this.logger.log('System health recovered to ok');
        const subject = '[ERP71] System recovered — all checks ok';
        const html = `<h2>System health recovered</h2><p>All checks returned to ok at ${report.generated_at}.</p>`;
        await this.dispatch(subject, html, 'ERP71 recovered: all checks ok');
    }

    /** Best-effort delivery — a failing channel never throws out of the cron. */
    private async dispatch(subject: string, html: string, smsText: string): Promise<void> {
        if (this.emailRecipients.length > 0) {
            await this.email
                .sendSystemAlert(this.emailRecipients, subject, html)
                .catch((err) => this.logger.error(`Failed to send alert email: ${err}`));
        }
        if (this.smsRecipients.length > 0) {
            // No tenantId — platform-level SMS, not billed to any tenant.
            await this.sms
                .sendSms(this.smsRecipients, smsText)
                .catch((err) => this.logger.error(`Failed to send alert SMS: ${err}`));
        }
    }
}
