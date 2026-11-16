import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CrmLeadAgingReportPage from './page';

const getCrmLeadAging = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCrmLeadAging: (...args: unknown[]) => getCrmLeadAging(...args),
    },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    as_of: '2026-11-15',
    stale_after_days: 14,
    buckets: [
        { key: '0-7', leads: 4, share_pct: 40, stale: 0, oldest_days: 7 },
        { key: '8-14', leads: 2, share_pct: 20, stale: 1, oldest_days: 14 },
        { key: '15-30', leads: 2, share_pct: 20, stale: 2, oldest_days: 30 },
        { key: '31-60', leads: 1, share_pct: 10, stale: 1, oldest_days: 45 },
        { key: '61-90', leads: 0, share_pct: 0, stale: 0, oldest_days: null },
        { key: '90+', leads: 1, share_pct: 10, stale: 1, oldest_days: 200 },
    ],
    by_stage: [
        { status: 'NEW', leads: 6, avg_age_days: 18.5, oldest_days: 200, stale: 3 },
        { status: 'CONTACTED', leads: 3, avg_age_days: 12, oldest_days: 30, stale: 1 },
        { status: 'QUALIFIED', leads: 1, avg_age_days: 45, oldest_days: 45, stale: 1 },
    ],
    totals: { open: 10, stale: 5, stale_pct: 50, avg_age_days: 22.7, oldest_days: 200 },
    ...overrides,
});

beforeEach(() => {
    localStorage.clear();
    getCrmLeadAging.mockReset().mockResolvedValue(report());
});

describe('CRM lead aging report', () => {
    it('asks for the open book, with no date window', async () => {
        render(<CrmLeadAgingReportPage />);

        await waitFor(() => expect(getCrmLeadAging).toHaveBeenCalled());
        expect(getCrmLeadAging).toHaveBeenCalledWith({ mine: false });
    });

    it('sends mine when the remembered toggle is on', async () => {
        localStorage.setItem('crm_mine_only', 'true');
        render(<CrmLeadAgingReportPage />);

        await waitFor(() => expect(getCrmLeadAging).toHaveBeenCalledWith({ mine: true }));
    });

    it('draws one row per age band with its share and staleness', async () => {
        render(<CrmLeadAgingReportPage />);

        const row = (await screen.findByRole('row', { name: /Over 90 days/ }));
        const cell = (id: string) => row.querySelector(`[data-column-id="${id}"]`)?.textContent;
        expect(cell('leads')).toBe('1');
        expect(cell('share_pct')).toBe('10%');
        expect(cell('stale')).toBe('1');
        expect(cell('oldest_days')).toBe('200');
    });

    it('switches between age bands and stages without refetching', async () => {
        render(<CrmLeadAgingReportPage />);
        await screen.findByRole('row', { name: /Over 90 days/ });

        fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'stage' } });

        expect(await screen.findByRole('row', { name: /Contacted/ })).toBeInTheDocument();
        expect(getCrmLeadAging).toHaveBeenCalledTimes(1);
    });

    it('shows the staleness rule with the tenant window', async () => {
        render(<CrmLeadAgingReportPage />);

        expect(await screen.findByText(/no activity for 14 days or more counts as stale/)).toBeInTheDocument();
    });

    it('shows the as-of day', async () => {
        render(<CrmLeadAgingReportPage />);

        // Rendered on the workspace locale, not as the raw API string.
        expect(await screen.findByText(/As of 15\/11\/2026/)).toBeInTheDocument();
    });

    it('shows a dash for an empty age band rather than a fake zero oldest', async () => {
        render(<CrmLeadAgingReportPage />);

        const row = await screen.findByRole('row', { name: /61–90 days/ });
        expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
    });

    it('handles an empty pipeline without crashing', async () => {
        getCrmLeadAging.mockResolvedValue(report({
            buckets: report().buckets.map((b) => ({ ...b, leads: 0, share_pct: null, stale: 0, oldest_days: null })),
            by_stage: [],
            totals: { open: 0, stale: 0, stale_pct: null, avg_age_days: null, oldest_days: null },
        }));
        render(<CrmLeadAgingReportPage />);

        expect(await screen.findByText('There are no open leads right now.')).toBeInTheDocument();
    });
});
