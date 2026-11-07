'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mockBranchScope } from '@/test-utils/branch-scope';
import LoyaltyPage from './page';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
    api: {
        getLoyaltyCustomersPaged: jest.fn(),
        getLoyaltyCustomersSummary: jest.fn(),
        getCustomerLoyaltyPoints: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// Desktop width: the one-row filter toolbar and the columns kept off phones.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/loyalty',
    useSearchParams: () => ({ get: jest.fn() }),
}));

/** A filter chip on the toolbar row — a button that opens its own popover. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 20, pages: 1 });
const RAHIM = { id: '1', name: 'Rahim Uddin', phone: '01711111111', loyalty_points: 250, last_transaction_at: null };
const SUMMARY = { count: 30, members: 12, points: 4200, earned: 800, redeemed: 350, windowed: false };

describe('LoyaltyPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope({ value: 'all', defaultValue: 'all' });
        const { api } = require('@/lib/api');
        api.getLoyaltyCustomersPaged.mockResolvedValue(page([RAHIM]));
        api.getLoyaltyCustomersSummary.mockResolvedValue(SUMMARY);
        api.getCustomerLoyaltyPoints.mockResolvedValue({
            ...RAHIM,
            transactions: [
                { id: 't1', type: 'EARN', points: 50, description: 'Sale INV-1', created_at: '2026-10-01T10:00:00.000Z' },
                { id: 't2', type: 'REDEEM', points: -20, description: null, created_at: '2026-10-05T10:00:00.000Z' },
            ],
        });
    });

    it('renders the page heading', async () => {
        render(<LoyaltyPage />);
        expect(screen.getByRole('heading', { name: 'Loyalty Points' })).toBeInTheDocument();
        await screen.findByText('Rahim Uddin');
    });

    it('displays loaded customer data, highest balance first, from every branch', async () => {
        const { api } = require('@/lib/api');
        render(<LoyaltyPage />);
        const row = (await screen.findByText('Rahim Uddin')).closest('tr')!;
        expect(within(row).getByText('250').closest('td')).toHaveClass('text-end');
        expect(api.getLoyaltyCustomersPaged).toHaveBeenCalledWith(
            expect.objectContaining({ page: 1, storeId: 'all', sortBy: 'loyalty_points', sortDir: 'desc' }),
        );
    });

    it('handles empty customer list', async () => {
        const { api } = require('@/lib/api');
        api.getLoyaltyCustomersPaged.mockResolvedValue(page([]));
        render(<LoyaltyPage />);
        expect(await screen.findByText('No customers found')).toBeInTheDocument();
    });

    it('searches on the server from the toolbar box', async () => {
        const { api } = require('@/lib/api');
        render(<LoyaltyPage />);
        await screen.findByText('Rahim Uddin');

        fireEvent.change(screen.getByPlaceholderText('Search by name or phone…'), { target: { value: 'rahim' } });

        await waitFor(() =>
            expect(api.getLoyaltyCustomersPaged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'rahim' })),
        );
        expect(api.getLoyaltyCustomersSummary).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'rahim' }));
    });

    it('shows this month\'s figures in the strip', async () => {
        render(<LoyaltyPage />);
        const strip = await screen.findByRole('region', { name: 'Loyalty figures' });
        await within(strip).findByText('4,200');
        expect(within(strip).getByText('Holding points')).toBeInTheDocument();
        expect(within(strip).getByText('Earned this month')).toBeInTheDocument();
        expect(within(strip).getByText('Redeemed this month')).toBeInTheDocument();
    });

    it('names the window once activity days are picked', async () => {
        const { api } = require('@/lib/api');
        api.getLoyaltyCustomersSummary.mockResolvedValue({ ...SUMMARY, windowed: true });
        render(<LoyaltyPage />);
        const strip = await screen.findByRole('region', { name: 'Loyalty figures' });
        expect(await within(strip).findByText('Earned')).toBeInTheDocument();
        expect(within(strip).getByText('Redeemed')).toBeInTheDocument();
    });

    it('filters on the points balance, for rows and strip alike', async () => {
        const { api } = require('@/lib/api');
        render(<LoyaltyPage />);
        await screen.findByText('Rahim Uddin');

        fireEvent.click(chip('Points'));
        fireEvent.change(screen.getByRole('combobox', { name: 'Points' }), { target: { value: 'gt' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Points (Amount)' }), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        await waitFor(() =>
            expect(api.getLoyaltyCustomersPaged).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, points: { op: 'gt', value: 100 } }),
            ),
        );
        expect(api.getLoyaltyCustomersSummary).toHaveBeenLastCalledWith(
            expect.objectContaining({ points: { op: 'gt', value: 100 } }),
        );
    });

    it('keeps the activity type behind More and sends it to the server', async () => {
        const { api } = require('@/lib/api');
        render(<LoyaltyPage />);
        await screen.findByText('Rahim Uddin');

        fireEvent.click(chip(/^More/));
        const more = screen.getByRole('dialog', { name: 'More' });
        fireEvent.click(within(more).getByRole('button', { name: /^Activity type/ }));
        fireEvent.click(within(more).getByRole('checkbox', { name: 'Redeem' }));

        await waitFor(() =>
            expect(api.getLoyaltyCustomersPaged).toHaveBeenLastCalledWith(expect.objectContaining({ activityTypes: ['REDEEM'] })),
        );
    });

    it('opens a customer\'s points history from the row', async () => {
        const { api } = require('@/lib/api');
        render(<LoyaltyPage />);
        const row = (await screen.findByText('Rahim Uddin')).closest('tr')!;

        fireEvent.click(within(row).getByRole('button', { name: 'Points history' }));

        const dialog = await screen.findByRole('dialog');
        expect(api.getCustomerLoyaltyPoints).toHaveBeenCalledWith('1');
        expect(await within(dialog).findByText('Sale INV-1')).toBeInTheDocument();
        expect(within(dialog).getByText('Earn')).toBeInTheDocument();
        expect(within(dialog).getByText('Redeem')).toBeInTheDocument();
    });

    it('adjusts points, then refreshes rows and strip', async () => {
        const { api, fetchWithAuth } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        fetchWithAuth.mockResolvedValue({});
        render(<LoyaltyPage />);
        const row = (await screen.findByText('Rahim Uddin')).closest('tr')!;
        const listCalls = api.getLoyaltyCustomersPaged.mock.calls.length;
        const summaryCalls = api.getLoyaltyCustomersSummary.mock.calls.length;

        fireEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
        fireEvent.change(await screen.findByLabelText('Points Adjustment'), { target: { value: '25' } });
        fireEvent.click(screen.getByRole('button', { name: 'Adjust Points' }));

        await waitFor(() =>
            expect(fetchWithAuth).toHaveBeenCalledWith('/loyalty/customers/1/adjust', expect.objectContaining({ method: 'POST' })),
        );
        await waitFor(() => expect(toast.success).toHaveBeenCalled());
        await waitFor(() => expect(api.getLoyaltyCustomersPaged.mock.calls.length).toBeGreaterThan(listCalls));
        expect(api.getLoyaltyCustomersSummary.mock.calls.length).toBeGreaterThan(summaryCalls);
    });

    it('refuses a zero adjustment inline, without calling the server', async () => {
        const { fetchWithAuth } = require('@/lib/api');
        render(<LoyaltyPage />);
        const row = (await screen.findByText('Rahim Uddin')).closest('tr')!;

        fireEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
        fireEvent.change(await screen.findByLabelText('Points Adjustment'), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Adjust Points' }));

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(fetchWithAuth).not.toHaveBeenCalled();
    });
});
