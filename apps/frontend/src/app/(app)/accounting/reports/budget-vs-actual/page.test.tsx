import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BudgetVsActualPage from './page';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getBudgetVsActual: jest.fn(),
        getAccountingSettings: jest.fn().mockResolvedValue({
            requireVoucherApproval: false,
            autoApproveSystemVouchers: true,
            reportsApprovedOnly: false,
        }),
    },
    fetchWithAuth: jest.fn().mockResolvedValue(null),
}));

// One row per account: Rent is budgeted for seven months, Utilities annually.
const RESPONSE = {
    fiscal_year: 2026,
    month: null,
    rows: [
        { account: { id: 'a1', name: 'Rent', code: '5101', type: 'EXPENSE' }, budget: 10000, actual: 12000, variance: -2000, variance_pct: -20, months: 7 },
        { account: { id: 'a2', name: 'Utilities', code: '5102', type: 'EXPENSE' }, budget: 5000, actual: 4000, variance: 1000, variance_pct: 20, months: null },
    ],
    totals: { budget: 15000, actual: 16000, variance: -1000 },
};

const MARCH = {
    fiscal_year: 2026,
    month: 3,
    rows: [
        { account: { id: 'a1', name: 'Rent', code: '5101', type: 'EXPENSE' }, budget: 1000, actual: 900, variance: 100, variance_pct: 10, months: 1 },
    ],
    totals: { budget: 1000, actual: 900, variance: 100 },
};

const taka = (value: number) => formatBDT(value, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 });

function stat(label: string) {
    const strip = screen.getByRole('region', { name: 'Report figures' });
    return within(strip).getByText(label).closest('div') as HTMLElement;
}

describe('Budget vs. actual', () => {
    beforeEach(() => {
        (api.getBudgetVsActual as jest.Mock).mockReset().mockResolvedValue(RESPONSE);
    });

    it('marks the overspend in red and counts the accounts over budget', async () => {
        render(<BudgetVsActualPage />);
        await screen.findByText('Rent');

        expect(within(stat('Variance')).getByText(taka(-1000))).toHaveClass('text-red-600');
        expect(within(stat('Accounts over budget')).getByText(/^1/)).toBeInTheDocument();
        expect(within(stat('Accounts over budget')).getByText(/of 2/)).toBeInTheDocument();
    });

    it('notes a year budgeted for only some of its months, and not in a month view', async () => {
        (api.getBudgetVsActual as jest.Mock).mockImplementation(({ month }: { month?: number }) =>
            Promise.resolve(month ? MARCH : RESPONSE));
        render(<BudgetVsActualPage />);
        await screen.findByText('Rent');

        expect(screen.getByText('7 of 12 months budgeted')).toBeInTheDocument();
        // The annual budget needs no note.
        expect(screen.getAllByText(/months budgeted/)).toHaveLength(1);

        fireEvent.change(screen.getByRole('combobox', { name: 'Month' }), { target: { value: '3' } });
        await waitFor(() => expect(screen.queryByText('Utilities')).not.toBeInTheDocument());
        expect(screen.queryByText(/months budgeted/)).not.toBeInTheDocument();
    });

    it('narrows to the accounts over budget, and the strip follows', async () => {
        render(<BudgetVsActualPage />);
        await screen.findByText('Rent');

        // The chip, not the column header of the same name.
        const chip = screen.getAllByRole('button', { name: 'Budget status' }).find((button) => button.hasAttribute('aria-haspopup'));
        fireEvent.click(chip as HTMLElement);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Within budget' }));

        await waitFor(() => expect(screen.queryByText('Rent')).not.toBeInTheDocument());
        expect(screen.getByText('Utilities')).toBeInTheDocument();
        expect(within(stat('Budget')).getByText(taka(5000))).toBeInTheDocument();
    });

    it('asks for the month picked on the month chip', async () => {
        render(<BudgetVsActualPage />);
        await screen.findByText('Rent');

        fireEvent.change(screen.getByRole('combobox', { name: 'Month' }), { target: { value: '3' } });

        await waitFor(() => expect(api.getBudgetVsActual).toHaveBeenLastCalledWith(expect.objectContaining({ month: 3 })));
    });

    it('totals the budget, actual and variance under the table, in red when over', async () => {
        render(<BudgetVsActualPage />);
        await screen.findByText('Rent');

        const footer = screen.getByRole('rowheader', { name: 'Totals' }).closest('tr') as HTMLElement;
        const cell = (columnId: string) => footer.querySelector(`[data-column-id="${columnId}"]`) as HTMLElement;
        expect(cell('budget')).toHaveTextContent(formatBDT(15000, { locale: 'en' }));
        expect(cell('actual')).toHaveTextContent(formatBDT(16000, { locale: 'en' }));
        expect(within(cell('variance')).getByText(formatBDT(-1000, { locale: 'en' }))).toHaveClass('text-red-600');
    });
});
