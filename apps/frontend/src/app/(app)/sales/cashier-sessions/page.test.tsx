'use client';
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


import { render, screen, waitFor } from '@testing-library/react';
import CashierSessionsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getOpenCashierSession: jest.fn(),
        getCashTransactions: jest.fn(),
        getActiveCounters: jest.fn(),
        openCashierSession: jest.fn(),
        closeCashierSession: jest.fn(),
        addCashTransaction: jest.fn(),
        getCashierSessionSummary: jest.fn(),
        getOpenCashierSessionsByStore: jest.fn(),
    },
}));

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
        const { api } = require('@/lib/api');
        api.getOpenCashierSession.mockRejectedValue(new Error('No open session'));
        api.getCashTransactions.mockResolvedValue([]);
        api.getActiveCounters.mockResolvedValue([]);
        api.getCashierSessionSummary.mockResolvedValue(null);
        api.getOpenCashierSessionsByStore.mockResolvedValue([]);
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
            expect(screen.getByText('Open Shift')).toBeInTheDocument();
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

        await waitFor(() => {
            expect(screen.getByText('Shift Summary')).toBeInTheDocument();
        });
        expect(screen.getByText('BKASH')).toBeInTheDocument();
        expect(screen.getAllByText(/900/).length).toBeGreaterThan(0);
    });

    it('lists the other tills open in the branch', async () => {
        const { api } = require('@/lib/api');
        api.getOpenCashierSessionsByStore.mockResolvedValue([
            {
                id: 'sess-2',
                opened_at: '2025-06-11T09:00:00Z',
                counter: { id: 'c2', name: 'Counter 2', counter_number: 2 },
                user: { id: 'u2', name: 'Rahim' },
                summary: { salesTotal: 300, expectedCash: 800 },
            },
        ]);

        render(<CashierSessionsPage />);

        await waitFor(() => {
            expect(screen.getByText('#2 — Counter 2')).toBeInTheDocument();
        });
        expect(screen.getByText(/Rahim/)).toBeInTheDocument();
    });

    it('says so plainly when no till is open', async () => {
        render(<CashierSessionsPage />);

        await waitFor(() => {
            expect(screen.getByText('No tills are open in this branch.')).toBeInTheDocument();
        });
    });
});
