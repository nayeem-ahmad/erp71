import { Injectable } from '@nestjs/common';
import type { CheckResult, DependencyState, SystemHealthReport } from '@retail-saas/shared-types';
import { DatabaseCheck } from './checks/database.check';
import { RedisCheck } from './checks/redis.check';
import { ExternalCheck } from './checks/external.check';
import { CronCheck } from './checks/cron.check';
import { JobTrackerService, JobStatus } from './jobs/job-tracker.service';

const SEVERITY: Record<'ok' | 'degraded' | 'down', number> = { ok: 0, degraded: 1, down: 2 };

/**
 * Computes the overall system status from individual check results.
 * - `disabled` checks are ignored entirely.
 * - `unknown` is treated as `degraded`.
 * - Non-critical dependencies are capped at `degraded` — a payment provider
 *   being unreachable degrades the system but doesn't take it `down`.
 */
export function rollupStatus(checks: CheckResult[]): DependencyState {
    let worst: 'ok' | 'degraded' | 'down' = 'ok';

    for (const check of checks) {
        if (check.state === 'disabled') continue;

        let effective: 'ok' | 'degraded' | 'down';
        if (check.state === 'unknown') {
            effective = 'degraded';
        } else if (check.state === 'down' && !check.critical) {
            effective = 'degraded';
        } else {
            effective = check.state;
        }

        if (SEVERITY[effective] > SEVERITY[worst]) {
            worst = effective;
        }
    }

    return worst;
}

@Injectable()
export class SystemHealthService {
    constructor(
        private readonly databaseCheck: DatabaseCheck,
        private readonly redisCheck: RedisCheck,
        private readonly externalCheck: ExternalCheck,
        private readonly cronCheck: CronCheck,
        private readonly jobTracker: JobTrackerService,
    ) {}

    async getReport(): Promise<SystemHealthReport> {
        const start = Date.now();

        // Run everything in parallel; a failing check resolves to a `down`
        // CheckResult rather than rejecting, so allSettled is belt-and-braces.
        const [database, redis, externals, cron] = await Promise.all([
            this.databaseCheck.run(),
            this.redisCheck.run(),
            this.externalCheck.run(),
            this.cronCheck.run(),
        ]);

        const checks: CheckResult[] = [database, redis, cron, ...externals];

        return {
            status: rollupStatus(checks),
            generated_at: new Date().toISOString(),
            uptime_seconds: Math.floor(process.uptime()),
            duration_ms: Date.now() - start,
            checks,
        };
    }

    async getDependencies(): Promise<CheckResult[]> {
        const [redis, externals] = await Promise.all([
            this.redisCheck.run(),
            this.externalCheck.run(),
        ]);
        return [redis, ...externals];
    }

    async getJobStatuses(): Promise<JobStatus[]> {
        return this.jobTracker.getJobStatuses();
    }
}
