import { MetricsService } from './metrics.service';
import { JOB_NAMES } from '../jobs/job-names';

describe('MetricsService', () => {
    let jobTracker: any;
    let service: MetricsService;

    beforeEach(() => {
        jobTracker = { getJobStatuses: jest.fn().mockResolvedValue([]) };
        service = new MetricsService(jobTracker);
        service.onModuleInit(); // registers default Node metrics
    });

    it('exposes the Prometheus content type', () => {
        expect(service.contentType).toContain('text/plain');
    });

    it('records HTTP requests into the registry', async () => {
        service.observeHttp('GET', '/products', 200, 0.12);
        service.observeHttp('GET', '/products', 500, 0.34);

        const output = await service.render();

        expect(output).toContain('http_requests_total');
        expect(output).toContain('status_class="2xx"');
        expect(output).toContain('status_class="5xx"');
        expect(output).toContain('http_request_duration_seconds');
        // Default process metrics should be present too.
        expect(output).toContain('nodejs_eventloop_lag_seconds');
    });

    it('refreshes job gauges from the tracker on render', async () => {
        const now = Date.now();
        jobTracker.getJobStatuses.mockResolvedValue([
            {
                name: JOB_NAMES.BILLING_DUNNING,
                label: 'Billing: dunning',
                schedule: '0 9 * * *',
                last_run_at: new Date(now).toISOString(),
                last_status: 'SUCCESS',
                last_success_at: new Date(now).toISOString(),
                last_duration_ms: 42,
                last_error: null,
                overdue: false,
            },
            {
                name: JOB_NAMES.CRM_CAMPAIGNS,
                label: 'CRM: campaigns',
                schedule: '*/5 * * * *',
                last_run_at: new Date(now).toISOString(),
                last_status: 'FAILED',
                last_success_at: null,
                last_duration_ms: 5,
                last_error: 'boom',
                overdue: true,
            },
        ]);

        const output = await service.render();

        expect(output).toContain('job_healthy');
        expect(output).toContain(`job_healthy{job="${JOB_NAMES.BILLING_DUNNING}"} 1`);
        expect(output).toContain(`job_healthy{job="${JOB_NAMES.CRM_CAMPAIGNS}"} 0`);
        expect(output).toContain(`job_last_duration_milliseconds{job="${JOB_NAMES.BILLING_DUNNING}"} 42`);
    });

    it('still renders if the job tracker query fails', async () => {
        jobTracker.getJobStatuses.mockRejectedValue(new Error('db down'));

        await expect(service.render()).resolves.toContain('http_requests_total');
    });
});
