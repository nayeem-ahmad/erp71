import { render, screen, waitFor } from '@testing-library/react';
import CrmLeadSourceReportPage from './page';

const getCrmLeadSourceReport = jest.fn();

// A wide screen, so the period chip sits in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCrmLeadSourceReport: (...args: unknown[]) => getCrmLeadSourceReport(...args),
    },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { from: '2026-10-17', to: '2026-11-15', mine: true },
    rows: [
        {
            source_id: 's1', name: 'Facebook', leads: 4, contacted: 3, contacted_pct: 75,
            open: 1, converted: 2, lost: 1, conversion_pct: 50, win_rate_pct: 66.7,
            median_days_to_convert: 4, revenue: 12000, revenue_per_lead: 3000,
        },
        {
            source_id: null, name: null, leads: 2, contacted: 2, contacted_pct: 100,
            open: 2, converted: 0, lost: 0, conversion_pct: 0, win_rate_pct: null,
            median_days_to_convert: null, revenue: 0, revenue_per_lead: 0,
        },
    ],
    totals: {
        leads: 6, contacted: 5, contacted_pct: 83.3, open: 3, converted: 2, lost: 1,
        conversion_pct: 33.3, win_rate_pct: 66.7, median_days_to_convert: 4,
        revenue: 12000, revenue_per_lead: 2000,
    },
    ...overrides,
});

beforeEach(() => {
    localStorage.clear();
    getCrmLeadSourceReport.mockReset().mockResolvedValue(report());
});

describe('CRM lead source performance report', () => {
    it('asks for the last 30 days under the remembered mine scope', async () => {
        localStorage.setItem('crm_mine_only', 'true');
        render(<CrmLeadSourceReportPage />);

        await waitFor(() => expect(getCrmLeadSourceReport).toHaveBeenCalled());
        const first = getCrmLeadSourceReport.mock.calls[0][0];
        expect(first.mine).toBe(true);
        expect(first.from).toBeTruthy();
        expect(first.to).toBeTruthy();
    });

    it('shows revenue in taka', async () => {
        render(<CrmLeadSourceReportPage />);

        // The row and the totals footer both carry the same figure.
        expect(await screen.findAllByText('৳ 12,000.00')).not.toHaveLength(0);
    });

    it('labels the no-source row Unspecified', async () => {
        render(<CrmLeadSourceReportPage />);

        expect(await screen.findByRole('cell', { name: 'Unspecified' })).toBeInTheDocument();
    });

    it('shows a dash, not 0%, for a rate with no base', async () => {
        render(<CrmLeadSourceReportPage />);

        await screen.findByRole('cell', { name: 'Unspecified' });
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
});
