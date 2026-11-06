'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({
      t: enMessages,
      locale: 'en',
      fmt: (template, values = {}) =>
        Object.entries(values).reduce(
          (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
          template,
        ),
    }),
    formatMessage: (template, values = {}) =>
      Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
      ),
  };
}, { virtual: true });


import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import MonthlySalesPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/api', () => ({
    api: {
        getMonthlySalesByCustomer: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/reports/monthly',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// A wide screen, so the chips sit in the toolbar and every column is drawn.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

/** A toolbar chip: a button that opens its own panel. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

/** The figure beside a label in the summary strip. */
function stat(label: string): string {
    const strip = screen.getByRole('region', { name: 'Monthly sales summary' });
    return within(strip).getByText(label).nextElementSibling?.textContent ?? '';
}

const tableBody = () => screen.getAllByRole('rowgroup').find((group) => group.tagName === 'TBODY')!;
const tableFooter = () => screen.getAllByRole('rowgroup').find((group) => group.tagName === 'TFOOT')!;

const mockMonthlyData = {
    months: ['2026-01', '2026-02', '2026-03'],
    rows: [
        {
            customer: { id: 'cust-1', name: 'Alice Rahman', phone: '01700000001' },
            total: 45000,
            monthly: [
                { month: '2026-01', revenue: 15000, orderCount: 2 },
                { month: '2026-02', revenue: 20000, orderCount: 3 },
                { month: '2026-03', revenue: 10000, orderCount: 1 },
            ],
        },
        {
            customer: { id: null, name: 'Walk-in Customer', phone: null },
            total: 12000,
            monthly: [
                { month: '2026-01', revenue: 5000, orderCount: 1 },
                { month: '2026-02', revenue: 7000, orderCount: 2 },
                { month: '2026-03', revenue: 0, orderCount: 0 },
            ],
        },
    ],
};

describe('MonthlySalesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        const { api } = require('@/lib/api');
        api.getMonthlySalesByCustomer.mockResolvedValue(mockMonthlyData);
    });

    it('renders the page heading', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Monthly Sales by Customer' })).toBeInTheDocument();
    });

    it('renders the subtitle', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('Month-by-month revenue breakdown per customer')).toBeInTheDocument();
        });
    });

    it('loads the last six whole months on mount', async () => {
        const { api } = require('@/lib/api');
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(api.getMonthlySalesByCustomer).toHaveBeenCalledTimes(1);
        });
        const [{ storeId, from, to }] = api.getMonthlySalesByCustomer.mock.calls[0];
        expect(storeId).toBe('store-1');
        expect(from).toMatch(/-01$/);
        expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('takes its period from the toolbar chip, not date boxes', async () => {
        const { api } = require('@/lib/api');
        render(<MonthlySalesPage />);
        await waitFor(() => expect(api.getMonthlySalesByCustomer).toHaveBeenCalledTimes(1));
        expect(screen.queryAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toHaveLength(0);

        fireEvent.click(chip(/^Period/));
        fireEvent.click(screen.getByRole('button', { name: 'Last 12 months' }));

        await waitFor(() => expect(api.getMonthlySalesByCustomer).toHaveBeenCalledTimes(2));
    });

    it('renders customer names and phones in the table, walk-ins by name', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Rahman')).toBeInTheDocument();
            expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
            expect(screen.getByText('01700000001')).toBeInTheDocument();
        });
    });

    it('renders table headers with month labels', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByRole('columnheader', { name: /Jan/i })).toBeInTheDocument();
        });
    });

    it('totals every month and the whole period in the total row', async () => {
        render(<MonthlySalesPage />);
        await screen.findByText('Alice Rahman');

        const footer = tableFooter();
        expect(footer).toHaveTextContent('Total');
        expect(footer).toHaveTextContent('৳ 20,000.00');
        expect(footer).toHaveTextContent('৳ 27,000.00');
        expect(footer).toHaveTextContent('৳ 57,000.00');
    });

    it('sums the customers shown in the summary strip', async () => {
        render(<MonthlySalesPage />);
        await screen.findByText('Alice Rahman');

        expect(stat('Customers')).toBe('2');
        expect(stat('Total Revenue')).toContain('57,000');
        expect(stat('Total Orders')).toBe('9');
        // Walk-ins are many people under one name, so only Alice counts as coming back.
        expect(stat('Bought in 2+ months')).toBe('1');
    });

    it('narrows to the customers picked, and the strip and total row follow', async () => {
        render(<MonthlySalesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.click(chip('Customer'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Walk-in Customer' }));

        await waitFor(() => expect(tableBody()).not.toHaveTextContent('Alice Rahman'));
        expect(stat('Customers')).toBe('1');
        expect(stat('Total Revenue')).toContain('12,000');
        expect(tableFooter()).toHaveTextContent('৳ 12,000.00');
    });

    it('searches by name or phone', async () => {
        render(<MonthlySalesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: '01700000001' } });

        await waitFor(() => expect(tableBody()).not.toHaveTextContent('Walk-in Customer'));
        expect(stat('Customers')).toBe('1');
    });

    it('shows empty state when no rows', async () => {
        const { api } = require('@/lib/api');
        api.getMonthlySalesByCustomer.mockResolvedValue({ months: [], rows: [] });
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('No sales recorded in this period')).toBeInTheDocument();
        });
    });

    it('shows error message on API failure', async () => {
        const { api } = require('@/lib/api');
        api.getMonthlySalesByCustomer.mockRejectedValue(new Error('Server error'));
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('Server error')).toBeInTheDocument();
        });
    });
});
