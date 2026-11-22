import { render, screen, waitFor } from '@testing-library/react';
import CrmLostLeadsPage from './page';

const getCrmLostLeads = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));
jest.mock('@/lib/api', () => ({
    api: { getCrmLostLeads: (...args: unknown[]) => getCrmLostLeads(...args) },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { from: '2026-10-17', to: '2026-11-15', mine: false },
    rows: [
        { lead_id: 'l1', name: 'Acme Ltd', reason: 'Price too high', closed_at: '2026-11-02', days_open: 32 },
        { lead_id: 'l2', name: 'Beta Co', reason: null, closed_at: '2026-11-03', days_open: 24 },
    ],
    by_reason: [
        { reason: 'Price too high', leads: 1, share_pct: 50, avg_days_open: 32 },
        { reason: null, leads: 1, share_pct: 50, avg_days_open: 24 },
    ],
    totals: { lost: 2, avg_days_open: 28 },
    ...overrides,
});

beforeEach(() => getCrmLostLeads.mockReset().mockResolvedValue(report()));

describe('CRM lost leads report', () => {
    it('asks for the window', async () => {
        render(<CrmLostLeadsPage />);

        await waitFor(() => expect(getCrmLostLeads).toHaveBeenCalled());
    });

    it('shows each lost lead with its reason and how long it was open', async () => {
        render(<CrmLostLeadsPage />);

        const row = await screen.findByRole('row', { name: /Acme Ltd/ });
        expect(row.querySelector('[data-column-id="reason"]')?.textContent).toBe('Price too high');
        expect(row.querySelector('[data-column-id="days_open"]')?.textContent).toBe('32');
    });

    it('says so when no reason was recorded rather than leaving the cell blank', async () => {
        render(<CrmLostLeadsPage />);

        const row = await screen.findByRole('row', { name: /Beta Co/ });
        expect(row.querySelector('[data-column-id="reason"]')?.textContent).toBe('No reason recorded');
    });

    it('names the folded tail as other reasons', async () => {
        getCrmLostLeads.mockResolvedValue(report({
            by_reason: [{ reason: '__other__', leads: 20, share_pct: 100, avg_days_open: 12 }],
        }));
        render(<CrmLostLeadsPage />);

        expect(await screen.findByText('Other reasons')).toBeInTheDocument();
    });

    it('handles a period with no losses', async () => {
        getCrmLostLeads.mockResolvedValue(report({ rows: [], by_reason: [], totals: { lost: 0, avg_days_open: null } }));
        render(<CrmLostLeadsPage />);

        expect(await screen.findByText('No leads were lost in this period.')).toBeInTheDocument();
    });
});
