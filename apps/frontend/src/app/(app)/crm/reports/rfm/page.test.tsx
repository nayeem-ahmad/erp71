import { render, screen, waitFor } from '@testing-library/react';
import CrmRfmPage from './page';

const getCrmRfm = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));
jest.mock('@/lib/api', () => ({
    api: { getCrmRfm: (...args: unknown[]) => getCrmRfm(...args) },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    as_of: '2026-11-15',
    rows: [
        { customer_id: 'c1', name: 'Karim Ahmed', orders: 12, revenue: 90000, recency_days: 3, recency: 5, frequency: 5, monetary: 5, code: '555', segment: 'champion' },
        { customer_id: 'c2', name: 'Rahima Begum', orders: 2, revenue: 800, recency_days: 200, recency: 1, frequency: 2, monetary: 1, code: '121', segment: 'hibernating' },
    ],
    by_segment: [
        { segment: 'champion', customers: 1, revenue: 90000, share_pct: 99.1 },
        { segment: 'hibernating', customers: 1, revenue: 800, share_pct: 0.9 },
    ],
    totals: { customers: 2, revenue: 90800, repeat: 2 },
    ...overrides,
});

beforeEach(() => getCrmRfm.mockReset().mockResolvedValue(report()));

describe('CRM customer value (RFM) report', () => {
    it('loads the scoring snapshot', async () => {
        render(<CrmRfmPage />);

        await waitFor(() => expect(getCrmRfm).toHaveBeenCalled());
    });

    it('shows the three scores and the segment each customer falls in', async () => {
        render(<CrmRfmPage />);

        const row = await screen.findByRole('row', { name: /Karim Ahmed/ });
        const cell = (id: string) => row.querySelector(`[data-column-id="${id}"]`)?.textContent;
        expect(cell('recency')).toBe('5');
        expect(cell('frequency')).toBe('5');
        expect(cell('code')).toBe('555');
        expect(cell('segment')).toBe('Champion');
    });

    it('names a lapsed big spender as at risk rather than the same as a nobody', async () => {
        render(<CrmRfmPage />);

        const row = await screen.findByRole('row', { name: /Rahima Begum/ });
        expect(row.querySelector('[data-column-id="segment"]')?.textContent).toBe('Hibernating');
    });

    it('counts customers per segment', async () => {
        render(<CrmRfmPage />);
        await screen.findByRole('row', { name: /Karim Ahmed/ });

        // Two tables are on the page, and both mention "Champion": scope to the one
        // that has a Customers column.
        const row = screen.getAllByRole('row', { name: /Champion/ })
            .find((tr) => tr.querySelector('[data-column-id="customers"]'))!;
        expect(row).toBeDefined();
        expect(row.querySelector('[data-column-id="customers"]')?.textContent).toBe('1');
        expect(row.querySelector('[data-column-id="share_pct"]')?.textContent).toBe('99.1%');
    });

    it('handles a book with no completed sales', async () => {
        getCrmRfm.mockResolvedValue(report({ rows: [], by_segment: [], totals: { customers: 0, revenue: 0, repeat: 0 } }));
        render(<CrmRfmPage />);

        expect(await screen.findByText('No completed sales yet.')).toBeInTheDocument();
    });
});
