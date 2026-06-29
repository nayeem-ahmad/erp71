import type { SystemHealthReport } from '@erp71/shared-types';
import { HealthAlertService } from './health-alert.service';

const report = (status: 'ok' | 'degraded' | 'down'): SystemHealthReport => ({
    status,
    generated_at: new Date().toISOString(),
    uptime_seconds: 1,
    duration_ms: 1,
    checks: [
        { name: 'database', label: 'PostgreSQL', critical: true, state: status === 'down' ? 'down' : 'ok' },
        { name: 'payments', label: 'Payment webhooks', critical: false, state: status === 'degraded' ? 'degraded' : 'ok', message: 'spike' },
    ],
});

describe('HealthAlertService', () => {
    let systemHealth: any;
    let email: any;
    let sms: any;
    let jobTracker: any;
    let service: HealthAlertService;

    beforeEach(() => {
        systemHealth = { getReport: jest.fn() };
        email = { sendSystemAlert: jest.fn().mockResolvedValue(undefined) };
        sms = { sendSms: jest.fn().mockResolvedValue(undefined) };
        jobTracker = { track: (_n: string, fn: () => any) => fn() };
        service = new HealthAlertService(systemHealth, email, sms, jobTracker);

        process.env.HEALTH_ALERT_EMAILS = 'ops@example.com';
        process.env.HEALTH_ALERT_COOLDOWN_MIN = '30';
        delete process.env.HEALTH_ALERT_SMS;
    });

    afterEach(() => {
        delete process.env.HEALTH_ALERT_EMAILS;
        delete process.env.HEALTH_ALERT_COOLDOWN_MIN;
    });

    it('does not alert when the system is healthy', async () => {
        systemHealth.getReport.mockResolvedValue(report('ok'));
        await service.evaluateImpl();
        expect(email.sendSystemAlert).not.toHaveBeenCalled();
    });

    it('alerts once when the system becomes degraded', async () => {
        systemHealth.getReport.mockResolvedValue(report('degraded'));
        await service.evaluateImpl();
        expect(email.sendSystemAlert).toHaveBeenCalledTimes(1);
        expect(email.sendSystemAlert.mock.calls[0][0]).toEqual(['ops@example.com']);
    });

    it('suppresses repeat alerts within the cooldown window', async () => {
        systemHealth.getReport.mockResolvedValue(report('down'));
        await service.evaluateImpl();
        await service.evaluateImpl();
        await service.evaluateImpl();
        expect(email.sendSystemAlert).toHaveBeenCalledTimes(1);
    });

    it('re-alerts after the cooldown elapses', async () => {
        process.env.HEALTH_ALERT_COOLDOWN_MIN = '0';
        systemHealth.getReport.mockResolvedValue(report('down'));
        await service.evaluateImpl();
        await service.evaluateImpl();
        expect(email.sendSystemAlert).toHaveBeenCalledTimes(2);
    });

    it('sends a single recovery notice when health returns to ok', async () => {
        systemHealth.getReport.mockResolvedValueOnce(report('down'));
        await service.evaluateImpl(); // alert

        systemHealth.getReport.mockResolvedValue(report('ok'));
        await service.evaluateImpl(); // recovery
        await service.evaluateImpl(); // no-op

        expect(email.sendSystemAlert).toHaveBeenCalledTimes(2); // 1 alert + 1 recovery
        expect(email.sendSystemAlert.mock.calls[1][1]).toContain('recovered');
    });

    it('does not send email when no recipients are configured', async () => {
        delete process.env.HEALTH_ALERT_EMAILS;
        systemHealth.getReport.mockResolvedValue(report('degraded'));
        await service.evaluateImpl();
        expect(email.sendSystemAlert).not.toHaveBeenCalled();
    });

    it('also sends SMS when HEALTH_ALERT_SMS is set', async () => {
        process.env.HEALTH_ALERT_SMS = '8801700000000';
        systemHealth.getReport.mockResolvedValue(report('down'));
        await service.evaluateImpl();
        expect(sms.sendSms).toHaveBeenCalledTimes(1);
        expect(sms.sendSms.mock.calls[0][0]).toEqual(['8801700000000']);
    });
});
