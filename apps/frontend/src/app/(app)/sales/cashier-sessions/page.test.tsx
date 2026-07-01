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
    },
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
});
