import { Injectable } from '@nestjs/common';
import type { CheckResult } from '@erp71/shared-types';
import { JobTrackerService } from '../jobs/job-tracker.service';

/**
 * Surfaces scheduled-job health: a job whose last run FAILED, or that hasn't
 * succeeded within its expected cadence, degrades the system. Non-critical —
 * cron problems don't take the system `down`.
 */
@Injectable()
export class CronCheck {
    constructor(private readonly jobTracker: JobTrackerService) {}

    async run(): Promise<CheckResult> {
        const base: Pick<CheckResult, 'name' | 'label' | 'critical'> = {
            name: 'cron_jobs',
            label: 'Scheduled jobs',
            critical: false,
        };

        try {
            const statuses = await this.jobTracker.getJobStatuses();

            const failing = statuses.filter((s) => s.last_status === 'FAILED');
            const overdue = statuses.filter((s) => s.overdue);
            const problems = new Set([...failing, ...overdue].map((s) => s.name));

            const details = {
                total: statuses.length,
                failing: failing.map((s) => s.name),
                overdue: overdue.map((s) => s.name),
                jobs: statuses,
            };

            if (problems.size > 0) {
                return {
                    ...base,
                    state: 'degraded',
                    message: `${problems.size} job(s) failing or overdue`,
                    details,
                };
            }

            return { ...base, state: 'ok', details };
        } catch (err) {
            return {
                ...base,
                state: 'unknown',
                message: err instanceof Error ? err.message : 'Could not read job history',
            };
        }
    }
}
