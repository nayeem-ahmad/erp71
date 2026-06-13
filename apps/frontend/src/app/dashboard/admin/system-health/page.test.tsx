'use client';

import { render, screen, waitFor } from '@testing-library/react';
import SystemHealthPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSystemHealth: jest.fn(),
        getSystemHealthJobs: jest.fn(),
    },
}));

import { api } from '@/lib/api';

const mockReport = {
    status: 'degraded' as const,
    generated_at: '2026-06-13T12:00:00Z',
    uptime_seconds: 90061,
    duration_ms: 42,
    checks: [
        { name: 'database', label: 'PostgreSQL', state: 'ok' as const, latency_ms: 12, critical: true },
        { name: 'redis', label: 'Upstash Redis', state: 'disabled' as const, critical: false },
        { name: 'cron_jobs', label: 'Scheduled jobs', state: 'degraded' as const, critical: false },
        { name: 'bkash', label: 'bKash', state: 'down' as const, message: 'Unreachable', critical: false },
    ],
};

const mockJobs = [
    {
        name: 'billing.dunning',
        label: 'Billing: dunning',
        schedule: '0 9 * * *',
        last_run_at: '2026-06-13T09:00:00Z',
        last_status: 'SUCCESS',
        last_success_at: '2026-06-13T09:00:00Z',
        last_duration_ms: 120,
        last_error: null,
        overdue: false,
    },
    {
        name: 'crm.process-scheduled-campaigns',
        label: 'CRM: campaigns',
        schedule: '*/5 * * * *',
        last_run_at: '2026-06-13T11:55:00Z',
        last_status: 'FAILED',
        last_success_at: null,
        last_duration_ms: 8,
        last_error: 'boom',
        overdue: true,
    },
];

describe('SystemHealthPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getSystemHealth as jest.Mock).mockResolvedValue(mockReport);
        (api.getSystemHealthJobs as jest.Mock).mockResolvedValue(mockJobs);
    });

    it('renders the overall status and dependency checks', async () => {
        render(<SystemHealthPage />);

        await waitFor(() => expect(screen.getByText('PostgreSQL')).toBeInTheDocument());
        // Overall status is degraded -> rendered via the status label map.
        expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0);
        expect(screen.getByText('bKash')).toBeInTheDocument();
        expect(screen.getByText('Unreachable')).toBeInTheDocument();
        // The cron rollup is shown as a jobs table, not in the dependency list.
        expect(screen.queryByText('Scheduled jobs')).not.toBeNull();
    });

    it('renders the scheduled jobs table with per-job state', async () => {
        render(<SystemHealthPage />);

        await waitFor(() => expect(screen.getByText('Billing: dunning')).toBeInTheDocument());
        expect(screen.getByText('CRM: campaigns')).toBeInTheDocument();
        expect(screen.getByText('Failed')).toBeInTheDocument();
        expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    it('shows an error message when the API fails', async () => {
        (api.getSystemHealth as jest.Mock).mockRejectedValue(new Error('nope'));
        render(<SystemHealthPage />);

        await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument());
    });
});
