import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { JOB_REGISTRY, JobName } from './job-names';

export interface JobStatus {
    name: string;
    label: string;
    schedule: string;
    last_run_at: string | null;
    last_status: string | null;
    last_success_at: string | null;
    last_duration_ms: number | null;
    last_error: string | null;
    overdue: boolean;
}

/**
 * Wraps scheduled-job execution so every run is recorded in the JobRun table
 * (start, duration, success/failure). Because jobs run on the in-memory
 * `@nestjs/schedule` scheduler with no persistent queue, a thrown error would
 * otherwise vanish silently — this gives platform admins a durable record and
 * powers overdue-job detection.
 */
@Injectable()
export class JobTrackerService {
    private readonly logger = new Logger(JobTrackerService.name);

    constructor(private readonly db: DatabaseService) {}

    /**
     * Runs `fn`, recording a JobRun row for the attempt. Tracking failures
     * (e.g. DB write issues) never mask the job's own result. The job's own
     * error is re-thrown so existing logging/Sentry capture is preserved.
     */
    async track<T>(jobName: JobName, fn: () => Promise<T>): Promise<T> {
        const run = await this.db.jobRun
            .create({ data: { job_name: jobName, status: 'RUNNING' } })
            .catch((err) => {
                this.logger.warn(`Could not record start of job ${jobName}: ${err}`);
                return null;
            });

        const start = Date.now();
        try {
            const result = await fn();
            await this.finish(run?.id, 'SUCCESS', Date.now() - start);
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.finish(run?.id, 'FAILED', Date.now() - start, message);
            this.logger.error(`Scheduled job ${jobName} failed: ${message}`);
            throw err;
        }
    }

    private async finish(
        id: string | undefined,
        status: 'SUCCESS' | 'FAILED',
        durationMs: number,
        error?: string,
    ): Promise<void> {
        if (!id) return;
        await this.db.jobRun
            .update({
                where: { id },
                data: { status, finished_at: new Date(), duration_ms: durationMs, error: error ?? null },
            })
            .catch((err) => this.logger.warn(`Could not record completion of job ${id}: ${err}`));
    }

    /**
     * Returns the latest run and latest success for every registered job, with
     * an `overdue` flag derived from each job's expected cadence.
     */
    async getJobStatuses(): Promise<JobStatus[]> {
        const now = Date.now();

        return Promise.all(
            JOB_REGISTRY.map(async (def) => {
                const [lastRun, lastSuccess] = await Promise.all([
                    this.db.jobRun.findFirst({
                        where: { job_name: def.name },
                        orderBy: { started_at: 'desc' },
                    }),
                    this.db.jobRun.findFirst({
                        where: { job_name: def.name, status: 'SUCCESS' },
                        orderBy: { finished_at: 'desc' },
                    }),
                ]);

                const lastSuccessAt = lastSuccess?.finished_at ?? null;
                // Only flag overdue once we have at least one recorded success to
                // measure against; a never-run job (e.g. fresh deploy) isn't overdue.
                const overdue = lastSuccessAt
                    ? now - lastSuccessAt.getTime() > def.maxIntervalMs
                    : false;

                return {
                    name: def.name,
                    label: def.label,
                    schedule: def.schedule,
                    last_run_at: lastRun?.started_at.toISOString() ?? null,
                    last_status: lastRun?.status ?? null,
                    last_success_at: lastSuccessAt?.toISOString() ?? null,
                    last_duration_ms: lastRun?.duration_ms ?? null,
                    last_error: lastRun?.status === 'FAILED' ? lastRun.error : null,
                    overdue,
                };
            }),
        );
    }

    /** Deletes JobRun rows older than the retention window. Returns rows removed. */
    async purgeOlderThan(days: number): Promise<number> {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const result = await this.db.jobRun.deleteMany({ where: { started_at: { lt: cutoff } } });
        return result.count;
    }
}
