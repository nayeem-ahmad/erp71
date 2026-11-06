import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FiscalPeriodsPage from './page';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getFiscalPeriods: jest.fn(),
        lockFiscalPeriod: jest.fn(),
        unlockFiscalPeriod: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

// The toolbar chips sit in the row only on a wide screen.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const period = (year: number, month: number, locked: boolean) => ({
    id: `${year}-${month}`,
    year,
    month,
    period_label: `M${month} ${year}`,
    start_date: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    end_date: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString(),
    is_locked: locked,
    locked_at: locked ? '2020-03-01T10:00:00.000Z' : null,
});

/** January locked, February ended but unlocked, December a year ahead still open. */
const PERIODS = [period(2020, 1, true), period(2020, 2, false), period(2999, 12, false)];

function chip(name: string): HTMLElement {
    const found = screen.getAllByRole('button', { name }).find((b) => b.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${name}`);
    return found;
}

const table = () => screen.getByRole('table');
const tile = (label: string) =>
    within(screen.getByRole('region', { name: 'Fiscal periods summary' })).getByText(label).parentElement as HTMLElement;

describe('FiscalPeriodsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getFiscalPeriods as jest.Mock).mockResolvedValue(PERIODS);
        (api.lockFiscalPeriod as jest.Mock).mockResolvedValue({});
    });

    it('lists the year as a table with a status per period and a strip', async () => {
        render(<FiscalPeriodsPage />);

        expect(await within(await screen.findByRole('table')).findByText('January 2020')).toBeInTheDocument();
        expect(api.getFiscalPeriods).toHaveBeenCalledWith({ year: new Date().getFullYear() });
        expect(tile('Periods')).toHaveTextContent('3');
        expect(tile('Locked')).toHaveTextContent('1');
        expect(tile('Ended, not locked')).toHaveTextContent('1');
        expect(tile('Locked through')).toHaveTextContent('January 2020');
    });

    it('narrows the periods by status from the toolbar chip', async () => {
        render(<FiscalPeriodsPage />);
        await within(await screen.findByRole('table')).findByText('January 2020');

        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Ended, not locked' }));

        await waitFor(() => expect(within(table()).queryByText('January 2020')).not.toBeInTheDocument());
        expect(within(table()).getByText('February 2020')).toBeInTheDocument();
        expect(tile('Periods')).toHaveTextContent('1');
    });

    it('keeps the fiscal year a required chip: no "All", and Clear all goes back to this year', async () => {
        render(<FiscalPeriodsPage />);
        await within(await screen.findByRole('table')).findByText('January 2020');
        const thisYear = new Date().getFullYear();
        const year = screen.getByRole('combobox', { name: 'Fiscal Year' });
        expect(within(year).queryByRole('option', { name: 'All' })).not.toBeInTheDocument();
        // At this year the chip is not a filter to clear.
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();

        fireEvent.change(year, { target: { value: String(thisYear - 1) } });
        await waitFor(() => expect(api.getFiscalPeriods).toHaveBeenLastCalledWith({ year: thisYear - 1 }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
        await waitFor(() => expect(api.getFiscalPeriods).toHaveBeenLastCalledWith({ year: thisYear }));
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
    });

    it('locks a period from its row action', async () => {
        render(<FiscalPeriodsPage />);
        await screen.findByText('February 2020');

        const row = screen.getByText('February 2020').closest('tr') as HTMLElement;
        fireEvent.click(within(row).getByRole('button', { name: 'Lock Period' }));

        await waitFor(() => expect(api.lockFiscalPeriod).toHaveBeenCalledWith({ year: 2020, month: 2 }));
        expect(toast.success).toHaveBeenCalledWith('February 2020 locked');
    });
});
