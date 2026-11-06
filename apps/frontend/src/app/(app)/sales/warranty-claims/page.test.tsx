'use client';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import { mockBranchScope } from '@/test-utils/branch-scope';
import WarrantyClaimsPage from './page';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ tenants: [] }),
        getWarrantyClaimsList: jest.fn(),
        getWarrantyClaimsListSummary: jest.fn(),
        searchCustomers: jest.fn(),
        lookupWarrantySerial: jest.fn(),
        createWarrantyClaim: jest.fn(),
        updateWarrantyClaimStatus: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/warranty-claims',
    useSearchParams: () => new URLSearchParams(),
}));

// Desktop width: the one-row filter toolbar (the phone gets a sheet instead).
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 20, pages: 1 });

const claim = {
    id: '1',
    claim_number: 'WC-0001',
    serial_number: 'SN123456',
    status: 'SUBMITTED',
    reason: 'Device not working',
    description: null,
    resolution_notes: null,
    replacement_serial_number: null,
    resolved_at: null,
    created_at: '2025-01-01T00:00:00Z',
    product: { name: 'Samsung TV 32"' },
    customer: { id: 'cust-1', name: 'Rahim Mia', phone: '01700000000' },
    sale: { id: 'sale-9', serial_number: 'INV-00009' },
};

/** A filter chip on the toolbar row — a button that opens its own popover. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

describe('WarrantyClaimsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        const { api } = require('@/lib/api');
        api.getWarrantyClaimsList.mockResolvedValue(page([claim]));
        api.getWarrantyClaimsListSummary.mockResolvedValue({
            count: 8,
            awaiting: 2,
            inProgress: 1,
            repaired: 2,
            replaced: 1,
            completed: 1,
            rejected: 1,
        });
        api.searchCustomers.mockResolvedValue([{ id: 'cust-1', name: 'Rahim Mia' }]);
    });

    it('renders the heading and the New Claim action', async () => {
        renderWithQueryClient(<WarrantyClaimsPage />);
        expect(await screen.findByRole('heading', { name: 'Warranty Claims' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /New Claim/ })).toBeInTheDocument();
    });

    it('lists claims with a translated status and a link to the sale', async () => {
        renderWithQueryClient(<WarrantyClaimsPage />);
        expect(await screen.findByText('WC-0001')).toBeInTheDocument();
        expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);
        expect(screen.queryByText('SUBMITTED')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'INV-00009' })).toHaveAttribute('href', '/sales/sale-9');
    });

    it('asks the header branch for its claims', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<WarrantyClaimsPage />);
        await screen.findByText('WC-0001');
        expect(api.getWarrantyClaimsList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, storeId: 'store-1' }));
    });

    it('shows where the filtered claims stand in the strip', async () => {
        renderWithQueryClient(<WarrantyClaimsPage />);
        const strip = await screen.findByRole('region', { name: 'Warranty claims summary' });
        await within(strip).findByText('8');
        expect(within(strip).getByText('Awaiting decision')).toBeInTheDocument();
        // Repaired and replaced together, the replacements called out.
        expect(within(strip).getByText('3')).toBeInTheDocument();
        expect(within(strip).getByText('· 1 replaced')).toBeInTheDocument();
    });

    it('filters status and customer on the server, for rows and strip alike', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<WarrantyClaimsPage />);
        await screen.findByText('WC-0001');

        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Approved' }));
        await waitFor(() =>
            expect(api.getWarrantyClaimsList).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'APPROVED' })),
        );
        expect(api.getWarrantyClaimsListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'APPROVED' }));

        fireEvent.click(chip('Customer'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Walk-in' }));
        await waitFor(() =>
            expect(api.getWarrantyClaimsList).toHaveBeenLastCalledWith(expect.objectContaining({ customerIds: ['none'] })),
        );
    });

    it('keeps Resolved behind More', async () => {
        renderWithQueryClient(<WarrantyClaimsPage />);
        await screen.findByText('WC-0001');

        fireEvent.click(chip(/^More/));
        const more = screen.getByRole('dialog', { name: 'More' });
        expect(within(more).getByRole('button', { name: /^Resolved/ })).toBeInTheDocument();
    });

    it('updates a claim\'s status with a toast and refreshes rows and strip', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.updateWarrantyClaimStatus.mockResolvedValue({ ...claim, status: 'APPROVED' });
        renderWithQueryClient(<WarrantyClaimsPage />);
        await screen.findByText('WC-0001');
        const summaryCalls = api.getWarrantyClaimsListSummary.mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: 'Update status' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Claim WC-0001 · Serial SN123456')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(api.updateWarrantyClaimStatus).toHaveBeenCalledWith('1', expect.objectContaining({ status: 'APPROVED' })),
        );
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Claim status updated'));
        await waitFor(() => expect(api.getWarrantyClaimsListSummary.mock.calls.length).toBeGreaterThan(summaryCalls));
    });
});
