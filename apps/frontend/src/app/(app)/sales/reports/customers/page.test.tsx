'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SalesByCustomerPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';
import { createdRangeFromPreset } from '@/lib/created-range';

jest.mock('@/lib/api', () => ({
    api: {
        getSalesByCustomer: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/customers',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const ROWS = [
    { customer: { id: 'c1', name: 'Karim Ahmed', phone: '01711000001', customer_code: 'C-1' }, orderCount: 4, revenue: 40000, avgOrderValue: 10000 },
    { customer: { id: 'c2', name: 'Rahima Begum', phone: null, customer_code: 'C-2' }, orderCount: 1, revenue: 5000, avgOrderValue: 5000 },
    { customer: { id: null, name: 'Walk-in Customer', phone: null, customer_code: null }, orderCount: 5, revenue: 15000, avgOrderValue: 3000 },
];

function api() {
    return require('@/lib/api').api;
}

function chip(name: RegExp) {
    return screen.getAllByRole('button', { name }).find((button) => button.getAttribute('aria-haspopup') === 'dialog')!;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling?.textContent;
}

describe('SalesByCustomerPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getSalesByCustomer.mockResolvedValue({
            summary: { totalRevenue: 60000, totalOrders: 10, customerCount: 3, avgOrderValue: 6000 },
            rows: ROWS,
        });
    });

    it('renders the heading and names walk-in sales as such', async () => {
        render(<SalesByCustomerPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Customer-wise Sales Summary' })).toBeInTheDocument();
        expect(await screen.findByRole('cell', { name: 'Karim Ahmed' })).toBeInTheDocument();
        expect(screen.getByRole('cell', { name: 'Walk-in' })).toBeInTheDocument();
    });

    it('asks for the last 30 days of the header branch', async () => {
        render(<SalesByCustomerPage />);
        await waitFor(() => expect(api().getSalesByCustomer).toHaveBeenCalledTimes(1));
        expect(api().getSalesByCustomer).toHaveBeenCalledWith({ storeId: 'store-1', ...createdRangeFromPreset('last30') });
    });

    it('fills the strip from the rows: walk-ins count as orders, not customers', async () => {
        render(<SalesByCustomerPage />);
        await screen.findByRole('cell', { name: 'Karim Ahmed' });

        expect(tile('Total Revenue')).toBe('৳ 60,000');
        expect(tile('Total Orders')).toBe('10');
        expect(tile('Customers')).toBe('2');
        expect(tile('Repeat customers')).toContain('1');
        expect(tile('Repeat customers')).toContain('50%');
        expect(tile('Avg Order Value')).toBe('৳ 6,000');
    });

    it('leaves walk-in sales out with the customer chip, and the strip follows', async () => {
        render(<SalesByCustomerPage />);
        await screen.findByRole('cell', { name: 'Walk-in' });

        fireEvent.click(chip(/^Customer/));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Walk-in' }));

        await waitFor(() => expect(screen.queryByRole('cell', { name: 'Karim Ahmed' })).not.toBeInTheDocument());
        expect(tile('Total Revenue')).toBe('৳ 15,000');
        expect(tile('Total Orders')).toBe('5');
    });

    it('keeps a totals row under the customers', async () => {
        render(<SalesByCustomerPage />);
        await screen.findByRole('cell', { name: 'Karim Ahmed' });
        expect(screen.getByText('Total')).toBeInTheDocument();
        expect(screen.getByText('৳ 60,000.00')).toBeInTheDocument();
    });

    it('shows the empty message when nothing sold', async () => {
        api().getSalesByCustomer.mockResolvedValue({ summary: null, rows: [] });
        render(<SalesByCustomerPage />);
        expect(await screen.findByText('No sales recorded in this period')).toBeInTheDocument();
    });

    it('handles API errors without crashing', async () => {
        api().getSalesByCustomer.mockRejectedValue(new Error('Unauthorized'));
        render(<SalesByCustomerPage />);
        await waitFor(() => expect(api().getSalesByCustomer).toHaveBeenCalled());
        expect(screen.getByRole('heading', { name: 'Customer-wise Sales Summary' })).toBeInTheDocument();
    });
});
