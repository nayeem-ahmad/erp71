import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { JobTrackerService } from '../jobs/job-tracker.service';

/**
 * Owns the Prometheus registry and the platform's custom metrics. Default
 * Node.js process metrics (event-loop lag, heap/RSS memory, GC, CPU, uptime)
 * are collected automatically via `collectDefaultMetrics`, so there is no
 * separate runtime collector.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
    readonly registry = new Registry();

    readonly httpRequestsTotal = new Counter({
        name: 'http_requests_total',
        help: 'Total HTTP requests, labelled by method, route template, and status class.',
        labelNames: ['method', 'route', 'status_class'] as const,
        registers: [this.registry],
    });

    readonly httpRequestDuration = new Histogram({
        name: 'http_request_duration_seconds',
        help: 'HTTP request duration in seconds.',
        labelNames: ['method', 'route', 'status_class'] as const,
        buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [this.registry],
    });

    // Job gauges are refreshed from the JobRun table on each scrape.
    private readonly jobLastRunTimestamp = new Gauge({
        name: 'job_last_run_timestamp_seconds',
        help: 'Unix timestamp of the most recent run of a scheduled job.',
        labelNames: ['job'] as const,
        registers: [this.registry],
    });

    private readonly jobLastSuccessTimestamp = new Gauge({
        name: 'job_last_success_timestamp_seconds',
        help: 'Unix timestamp of the most recent successful run of a scheduled job.',
        labelNames: ['job'] as const,
        registers: [this.registry],
    });

    private readonly jobLastDurationMs = new Gauge({
        name: 'job_last_duration_milliseconds',
        help: 'Duration of the most recent run of a scheduled job, in milliseconds.',
        labelNames: ['job'] as const,
        registers: [this.registry],
    });

    private readonly jobHealthy = new Gauge({
        name: 'job_healthy',
        help: '1 if the job is healthy, 0 if its last run failed or it is overdue.',
        labelNames: ['job'] as const,
        registers: [this.registry],
    });

    constructor(private readonly jobTracker: JobTrackerService) {}

    onModuleInit() {
        collectDefaultMetrics({ register: this.registry });
    }

    /** Records one observed HTTP request. */
    observeHttp(method: string, route: string, statusCode: number, durationSeconds: number): void {
        const status_class = `${Math.floor(statusCode / 100)}xx`;
        const labels = { method, route, status_class };
        this.httpRequestsTotal.inc(labels);
        this.httpRequestDuration.observe(labels, durationSeconds);
    }

    /** Pulls the latest job statuses from the DB and updates the job gauges. */
    private async refreshJobMetrics(): Promise<void> {
        const statuses = await this.jobTracker.getJobStatuses();
        for (const s of statuses) {
            const labels = { job: s.name };
            if (s.last_run_at) {
                this.jobLastRunTimestamp.set(labels, new Date(s.last_run_at).getTime() / 1000);
            }
            if (s.last_success_at) {
                this.jobLastSuccessTimestamp.set(labels, new Date(s.last_success_at).getTime() / 1000);
            }
            if (s.last_duration_ms != null) {
                this.jobLastDurationMs.set(labels, s.last_duration_ms);
            }
            const healthy = s.last_status !== 'FAILED' && !s.overdue;
            this.jobHealthy.set(labels, healthy ? 1 : 0);
        }
    }

    /** Prometheus exposition text. Refreshes DB-derived gauges first. */
    async render(): Promise<string> {
        await this.refreshJobMetrics().catch(() => {
            // A DB hiccup shouldn't break the whole scrape — emit the rest.
        });
        return this.registry.metrics();
    }

    get contentType(): string {
        return this.registry.contentType;
    }
}
