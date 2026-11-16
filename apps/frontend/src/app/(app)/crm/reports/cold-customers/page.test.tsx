'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrmColdCustomersReportPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

const getColdCustomers = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/crm/reports/cold-customers',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getColdCustomers: (...args: unknown[]) => getColdCustomers(...args),
    },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    as_of: '2026-11-15',
    store_id: 'store-1',
    factor: 2,
    min_gap_days: 7,
    rows: [
        {
            customer_id: 'c1', name: 'Karim Ahmed', phone: '01711000001', customer_code: 'C-1',
            segment: 'Regular', orders: 4, lifetime_spend: 40000, avg_gap_days: 10,
            days_since_last: 45, overdue_days: 35, last_purchase_date: '2026-10-01',
            last_contacted_at: '2026-10-20T10:00:00.000Z', has_open_follow_up: true,
        },
        {
            customer_id: 'c2', name: 'Rahima Begum', phone: null, customer_code: null,
            segment: 'Regular', orders: 2, lifetime_spend: 5000, avg_gap_days: 14,
            days_since_last: 40, overdue_days: 26, last_purchase_date: '2026-10-05',
            last_contacted_at: null, has_open_follow_up: false,
        },
    ],
    total: 2,
    truncated: false,
    ...overrides,
});

beforeEach(() => {
    mockBranchScope();
    getColdCustomers.mockReset().mockResolvedValue(report());
});

describe('CRM customers going cold report', () => {
    it('asks with the branch and a factor of 2', async () => {
        render(<CrmColdCustomersReportPage />);

        await waitFor(() => expect(getColdCustomers).toHaveBeenCalled());
        expect(getColdCustomers.mock.calls[0][0]).toEqual({ storeId: 'store-1', factor: 2 });
    });

    it('refetches with the chosen factor', async () => {
        render(<CrmColdCustomersReportPage />);
        await waitFor(() => expect(getColdCustomers).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByRole('combobox', { name: 'Threshold factor' }), { target: { value: '3' } });

        await waitFor(() => expect(getColdCustomers).toHaveBeenCalledTimes(2));
        expect(getColdCustomers.mock.calls[1][0].factor).toBe(3);
    });

    it('links each customer to their page', async () => {
        render(<CrmColdCustomersReportPage />);

        const link = await screen.findByRole('link', { name: 'Karim Ahmed' });
        expect(link).toHaveAttribute('href', '/sales/customers/c1');
    });

    it('says when the list was cut to the most valuable', async () => {
        // The server sends the 2000 most valuable rows and says how many there were.
        const many = Array.from({ length: 2000 }, (_, index) => ({
            ...report().rows[0],
            customer_id: `c${index}`,
            name: `Customer ${index}`,
        }));
        getColdCustomers.mockResolvedValue(report({ rows: many, total: 2600, truncated: true }));
        render(<CrmColdCustomersReportPage />);

        expect(await screen.findByText(/Showing the 2,000 most valuable of 2,600\./)).toBeInTheDocument();
    });

    it('shows Never for a customer nobody has contacted', async () => {
        render(<CrmColdCustomersReportPage />);

        expect(await screen.findByRole('cell', { name: 'Never' })).toBeInTheDocument();
    });
});
