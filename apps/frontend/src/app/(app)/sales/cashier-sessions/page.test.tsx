'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({
      t: enMessages,
      locale: 'en',
    }),
    formatMessage: (template, values = {}) =>
      Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
      ),
  };
}, { virtual: true });


import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CashierSessionsPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/api', () => ({
    api: {
        getOpenCashierSession: jest.fn(),
        getCashTransactions: jest.fn(),
        getActiveCounters: jest.fn(),
        openCashierSession: jest.fn(),
        closeCashierSession: jest.fn(),
        addCashTransaction: jest.fn(),
        getCashierSessionSummary: jest.fn(),
        getCashierSessionOverview: jest.fn(),
    },
}));

// Desktop width: the one-row filter toolbar (the phone gets a sheet instead).
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

/** A filter chip on the toolbar row — a button that opens its own popover. */
function chip(name: string | RegExp, scope: HTMLElement = document.body): HTMLElement {
    const found = within(scope)
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

const openTill = {
    id: 'sess-2',
    status: 'OPEN',
    store: { id: 'store-1', name: 'Dhaka Branch' },
    opened_at: '2025-06-11T09:00:00Z',
    closed_at: null,
    counter: { id: 'c2', name: 'Counter 2', counter_number: 2 },
    cashier: { id: 'u2', name: 'Rahim' },
    opening_cash: 500,
    sales_count: 4,
    sales_total: 300,
    cash_takings: 300,
    expected_cash: 800,
    closing_cash: null,
    variance: null,
};

const shortTill = {
    ...openTill,
    id: 'sess-3',
    status: 'CLOSED',
    closed_at: '2025-06-11T14:00:00Z',
    counter: { id: 'c3', name: 'Counter 3', counter_number: 3 },
    cashier: { id: 'u3', name: 'Karim' },
    sales_count: 6,
    sales_total: 1200,
    cash_takings: null,
    expected_cash: 1500,
    closing_cash: 1450,
    variance: -50,
};

const overview = (open: unknown[] = [], closed: unknown[] = []) => ({ store_id: 'store-1', open, closed_today: closed });

// The page scopes both the counter list and the open-till list to the active
// branch, so without a store there is nothing to ask for.
jest.mock('@/lib/session-store', () => ({
    getWorkspaceItem: (key: string) => (key === 'store_id' ? 'store-1' : null),
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/cashier-sessions',
    useSearchParams: () => ({ get: jest.fn() }),
}));

describe('CashierSessionsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        const { api } = require('@/lib/api');
        api.getOpenCashierSession.mockRejectedValue(new Error('No open session'));
        api.getCashTransactions.mockResolvedValue([]);
        api.getActiveCounters.mockResolvedValue([]);
        api.getCashierSessionSummary.mockResolvedValue(null);
        api.getCashierSessionOverview.mockResolvedValue(overview());
    });

    it('renders the page heading', async () => {
        const { api } = require('@/lib/api');
        api.getOpenCashierSession.mockRejectedValue(new Error('No open session'));
        api.getActiveCounters.mockResolvedValue([]);
        render(<CashierSessionsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Cashier Session' })).toBeInTheDocument();
        });
    });

    it('shows Open Session button when no session is active', async () => {
        const { api } = require('@/lib/api');
        api.getOpenCashierSession.mockRejectedValue(new Error('No open session'));
        api.getActiveCounters.mockResolvedValue([]);
        render(<CashierSessionsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Open Shift' })).toBeInTheDocument();
        });
    });

    it('shows session details when session is open', async () => {
        const { api } = require('@/lib/api');
        api.getOpenCashierSession.mockResolvedValue({
            id: 'sess-1',
            counter: { name: 'Counter 1' },
            opened_at: '2025-06-11T08:00:00Z',
            opening_cash: '500',
            status: 'OPEN',
        });
        api.getCashTransactions.mockResolvedValue([]);
        render(<CashierSessionsPage />);
        await waitFor(() => {
            expect(screen.getByText('Counter 1')).toBeInTheDocument();
        });
    });
    it('shows what the shift has taken, not just the cash movements typed in', async () => {
        const { api } = require('@/lib/api');
        api.getOpenCashierSession.mockResolvedValue({
            id: 'sess-1',
            counter: { name: 'Counter 1' },
            opened_at: '2025-06-11T08:00:00Z',
            opening_cash: '500',
            status: 'OPEN',
        });
        api.getCashierSessionSummary.mockResolvedValue({
            salesCount: 3,
            salesTotal: 1250,
            cashTakings: 400,
            refunds: 0,
            openingCash: 500,
            cashIn: 0,
            cashOut: 0,
            // 500 float + 400 cash taken. The page used to show 500 here,
            // because it could only see the cash in/out box.
            expectedCash: 900,
            closingCash: null,
            variance: null,
            paymentBreakdown: [
                { method: 'CASH', amount: 400 },
                { method: 'BKASH', amount: 850 },
            ],
        });

        render(<CashierSessionsPage />);

        const strip = await screen.findByRole('region', { name: 'Shift Summary' });
        await within(strip).findByText('Total Takings');
        expect(within(strip).getByText('Expected Cash').parentElement).toHaveTextContent('900');
        expect(within(strip).getByText('Cash Sales').parentElement).toHaveTextContent('400');
        expect(screen.getByText('BKASH')).toBeInTheDocument();
    });

    it('lists the tills open in the branch and the shifts closed today', async () => {
        const { api } = require('@/lib/api');
        api.getCashierSessionOverview.mockResolvedValue(overview([openTill], [shortTill]));

        render(<CashierSessionsPage />);

        expect(await screen.findByText('#2 — Counter 2')).toBeInTheDocument();
        expect(screen.getByText('Rahim')).toBeInTheDocument();
        expect(screen.getByText('#3 — Counter 3')).toBeInTheDocument();
        // Counted 1,450 against 1,500 expected.
        expect(screen.getByText(/^−৳\s?50\.00$/)).toBeInTheDocument();
    });

    it('sums the filtered tills in the strip: cash in drawers, takings, shortfalls', async () => {
        const { api } = require('@/lib/api');
        api.getCashierSessionOverview.mockResolvedValue(overview([openTill], [shortTill]));

        render(<CashierSessionsPage />);

        const strip = await screen.findByRole('region', { name: 'Tills summary' });
        expect(await within(strip).findByText('Cash in drawers')).toBeInTheDocument();
        expect(within(strip).getByText('Cash in drawers').parentElement).toHaveTextContent('800');
        expect(within(strip).getByText('Short').parentElement).toHaveTextContent('50');
        expect(within(strip).getByText('Total Takings').parentElement).toHaveTextContent('1,500');

        // Short shifts only: the open till drops out of the rows and the strip.
        fireEvent.click(chip('Difference'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Short' }));

        await waitFor(() => expect(screen.queryByText('#2 — Counter 2')).not.toBeInTheDocument());
        expect(within(strip).getByText('Cash in drawers').parentElement).toHaveTextContent('0');
        expect(within(strip).getByText('Total Takings').parentElement).toHaveTextContent('1,200');
    });

    it('says so plainly when no till was opened today', async () => {
        render(<CashierSessionsPage />);

        await waitFor(() => {
            expect(screen.getByText('No tills opened in this branch today.')).toBeInTheDocument();
        });
    });

    it('shows the filtered branch\'s floor, while the own shift stays on the header branch', async () => {
        const { api } = require('@/lib/api');
        render(<CashierSessionsPage />);
        await waitFor(() => expect(api.getCashierSessionOverview).toHaveBeenCalledWith('store-1'));

        fireEvent.change(await screen.findByRole('combobox', { name: 'Branch' }), { target: { value: 'store-2' } });

        await waitFor(() => expect(api.getCashierSessionOverview).toHaveBeenLastCalledWith('store-2'));
        expect(api.getActiveCounters).toHaveBeenCalledWith('store-1');
        expect(api.getActiveCounters).not.toHaveBeenCalledWith('store-2');
        expect(screen.queryByRole('option', { name: 'All branches' })).not.toBeInTheDocument();
    });

    it('filters the shift\'s cash movements by direction, and its strip follows', async () => {
        const { api } = require('@/lib/api');
        api.getOpenCashierSession.mockResolvedValue({
            id: 'sess-1',
            counter: { name: 'Counter 1' },
            opened_at: '2025-06-11T08:00:00Z',
            opening_cash: '500',
            status: 'OPEN',
        });
        api.getCashTransactions.mockResolvedValue([
            { id: 'tx-1', amount: '200', type: 'DROP', description: 'Float top-up', created_at: '2025-06-11T09:00:00Z' },
            { id: 'tx-2', amount: '-75', type: 'PAYOUT', description: 'Tea for staff', created_at: '2025-06-11T10:00:00Z' },
        ]);

        render(<CashierSessionsPage />);

        expect(await screen.findByText('Tea for staff')).toBeInTheDocument();
        const strip = screen.getByRole('region', { name: 'Cash movements summary' });
        expect(within(strip).getByText('Net').parentElement).toHaveTextContent('125');

        const table = strip.parentElement as HTMLElement;
        fireEvent.click(chip('Direction', table));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Cash Out' }));

        await waitFor(() => expect(screen.queryByText('Float top-up')).not.toBeInTheDocument());
        expect(within(strip).getByText('Movements').parentElement).toHaveTextContent('1');
        expect(within(strip).getByText('Net').parentElement).toHaveTextContent('-75');
    });
});
