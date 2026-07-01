import { render, screen, waitFor } from '@testing-library/react';
import StatusPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSystemHealth: jest.fn(),
        getSystemHealthJobs: jest.fn(),
    },
}));

import { api } from '@/lib/api';

const mockReport = {
    status: 'ok' as const,
    generated_at: '2026-06-13T12:00:00Z',
    uptime_seconds: 90061,
    duration_ms: 42,
    checks: [
        { name: 'database', label: 'PostgreSQL', state: 'ok' as const, latency_ms: 12, critical: true },
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
];

describe('StatusPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getSystemHealth as jest.Mock).mockResolvedValue(mockReport);
        (api.getSystemHealthJobs as jest.Mock).mockResolvedValue(mockJobs);
    });

    it('renders the platform-admin status heading and health details', async () => {
        render(<StatusPage />);

        expect(screen.getByRole('heading', { name: 'System Status' })).toBeInTheDocument();
        expect(screen.getByText('Restricted to platform administrators.')).toBeInTheDocument();
        expect(screen.getByText('Open full system health dashboard')).toBeInTheDocument();

        await waitFor(() => expect(screen.getByText('PostgreSQL')).toBeInTheDocument());
        expect(screen.getByText('Billing: dunning')).toBeInTheDocument();
    });
});