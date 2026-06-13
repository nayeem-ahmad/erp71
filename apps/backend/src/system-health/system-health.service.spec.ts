import type { CheckResult } from '@retail-saas/shared-types';
import { SystemHealthService, rollupStatus } from './system-health.service';

const check = (overrides: Partial<CheckResult>): CheckResult => ({
    name: 'x',
    label: 'X',
    state: 'ok',
    critical: false,
    ...overrides,
});

describe('rollupStatus', () => {
    it('returns ok when everything is ok', () => {
        expect(rollupStatus([check({}), check({ state: 'ok' })])).toBe('ok');
    });

    it('ignores disabled dependencies', () => {
        expect(rollupStatus([check({ state: 'ok' }), check({ state: 'disabled' })])).toBe('ok');
    });

    it('goes down when a critical dependency is down', () => {
        const checks = [check({ name: 'database', critical: true, state: 'down' })];
        expect(rollupStatus(checks)).toBe('down');
    });

    it('caps a non-critical dependency being down at degraded', () => {
        const checks = [
            check({ name: 'database', critical: true, state: 'ok' }),
            check({ name: 'bkash', critical: false, state: 'down' }),
        ];
        expect(rollupStatus(checks)).toBe('degraded');
    });

    it('treats unknown as degraded', () => {
        expect(rollupStatus([check({ state: 'unknown' })])).toBe('degraded');
    });

    it('reports the worst severity across checks', () => {
        const checks = [
            check({ name: 'database', critical: true, state: 'degraded' }),
            check({ name: 'redis', critical: false, state: 'down' }),
        ];
        expect(rollupStatus(checks)).toBe('degraded');

        const withCriticalDown = [
            check({ name: 'database', critical: true, state: 'down' }),
            check({ name: 'redis', critical: false, state: 'degraded' }),
        ];
        expect(rollupStatus(withCriticalDown)).toBe('down');
    });
});

describe('SystemHealthService', () => {
    const makeService = (
        database: CheckResult,
        redis: CheckResult,
        externals: CheckResult[],
        cron: CheckResult = check({ name: 'cron_jobs', label: 'Scheduled jobs', state: 'ok' }),
    ) =>
        new SystemHealthService(
            { run: jest.fn().mockResolvedValue(database) } as any,
            { run: jest.fn().mockResolvedValue(redis) } as any,
            { run: jest.fn().mockResolvedValue(externals) } as any,
            { run: jest.fn().mockResolvedValue(cron) } as any,
            { getJobStatuses: jest.fn().mockResolvedValue([]) } as any,
        );

    it('aggregates all checks into a report', async () => {
        const service = makeService(
            check({ name: 'database', label: 'PostgreSQL', critical: true, state: 'ok' }),
            check({ name: 'redis', label: 'Upstash Redis', state: 'disabled' }),
            [check({ name: 'bkash', label: 'bKash', state: 'ok' })],
        );

        const report = await service.getReport();

        expect(report.status).toBe('ok');
        expect(report.checks).toHaveLength(4);
        expect(report.checks.map((c) => c.name)).toEqual(['database', 'redis', 'cron_jobs', 'bkash']);
        expect(typeof report.uptime_seconds).toBe('number');
        expect(typeof report.duration_ms).toBe('number');
        expect(() => new Date(report.generated_at).toISOString()).not.toThrow();
    });

    it('reports down when the database is down', async () => {
        const service = makeService(
            check({ name: 'database', critical: true, state: 'down' }),
            check({ name: 'redis', state: 'disabled' }),
            [],
        );

        const report = await service.getReport();
        expect(report.status).toBe('down');
    });

    it('degrades when a cron job is failing or overdue', async () => {
        const service = makeService(
            check({ name: 'database', critical: true, state: 'ok' }),
            check({ name: 'redis', state: 'disabled' }),
            [],
            check({ name: 'cron_jobs', label: 'Scheduled jobs', state: 'degraded', message: '1 job(s) failing or overdue' }),
        );

        const report = await service.getReport();
        expect(report.status).toBe('degraded');
    });
});
