import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CrmScorecardReportPage from './page';

const getCrmScorecard = jest.fn();

// A wide screen, so the period chip sits in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCrmScorecard: (...args: unknown[]) => getCrmScorecard(...args),
    },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { from: '2026-10-17', to: '2026-11-15', mine: false },
    rows: [
        {
            user_id: 'u1', name: 'Karim Ahmed', open_leads: 6, new_leads: 3,
            activities_logged: 12, leads_touched: 5, follow_ups_due: 8,
            follow_ups_on_time_pct: 87.5, overdue_now: 1, converted: 2, lost: 1,
            win_rate_pct: 66.7, revenue: 40000,
        },
        {
            user_id: 'u2', name: 'Rahima Begum', open_leads: 2, new_leads: 1,
            activities_logged: 3, leads_touched: 2, follow_ups_due: 0,
            follow_ups_on_time_pct: null, overdue_now: 0, converted: 0, lost: 0,
            win_rate_pct: null, revenue: 0,
        },
    ],
    totals: {
        open_leads: 8, new_leads: 4, activities_logged: 15, leads_touched: 7,
        follow_ups_due: 8, follow_ups_on_time_pct: 87.5, overdue_now: 1,
        converted: 2, lost: 1, win_rate_pct: 66.7, revenue: 40000,
    },
    ...overrides,
});

beforeEach(() => {
    localStorage.clear();
    getCrmScorecard.mockReset().mockResolvedValue(report());
});

describe('CRM salesperson scorecard report', () => {
    it('renders one row per person with on-time % and revenue', async () => {
        render(<CrmScorecardReportPage />);

        expect(await screen.findByRole('cell', { name: 'Karim Ahmed' })).toBeInTheDocument();
        expect(screen.getByRole('cell', { name: 'Rahima Begum' })).toBeInTheDocument();
        expect(screen.getAllByRole('cell', { name: '87.5%' }).length).toBeGreaterThan(0);
        expect(screen.getAllByText('৳ 40,000.00').length).toBeGreaterThan(0);
    });

    it('shows a dash for a person with nothing closed', async () => {
        render(<CrmScorecardReportPage />);

        const row = (await screen.findByRole('cell', { name: 'Rahima Begum' })).closest('tr')!;
        // Win rate and on-time have no base for this person.
        expect(within(row).getAllByText('—').length).toBe(2);
    });

    it('sends mine when the toggle is on and refetches when it changes', async () => {
        localStorage.setItem('crm_mine_only', 'true');
        render(<CrmScorecardReportPage />);

        await waitFor(() => expect(getCrmScorecard).toHaveBeenCalledTimes(1));
        expect(getCrmScorecard.mock.calls[0][0].mine).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: /Only mine/ }));

        await waitFor(() => expect(getCrmScorecard).toHaveBeenCalledTimes(2));
        expect(getCrmScorecard.mock.calls[1][0].mine).toBe(false);
    });
});
