'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { formatBDT } from '@/lib/format';
import PriceListsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getPriceLists: jest.fn(),
        createPriceList: jest.fn(),
        updatePriceList: jest.fn(),
        deletePriceList: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// Desktop width: the one-row filter toolbar and the columns kept off phones.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/price-lists',
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

const mockLists = [
    {
        id: 'pl-1',
        name: 'Retail',
        description: 'Shelf prices',
        is_default: true,
        overall_discount_type: null,
        overall_discount_value: null,
        _count: { items: 120, customerGroups: 0 },
    },
    {
        id: 'pl-2',
        name: 'Wholesale',
        description: null,
        is_default: false,
        overall_discount_type: 'PERCENTAGE',
        overall_discount_value: '7.5',
        _count: { items: 80, customerGroups: 2 },
    },
    {
        id: 'pl-3',
        name: 'Eid Offer',
        description: null,
        is_default: false,
        overall_discount_type: 'FIXED_AMOUNT',
        overall_discount_value: '50',
        _count: { items: 10, customerGroups: 0 },
    },
];

describe('PriceListsPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getPriceLists.mockResolvedValue(mockLists);
        api.deletePriceList.mockResolvedValue({});
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('lists each price list, linked to its prices, with the default marked', async () => {
        render(<PriceListsPage />);
        const retail = await screen.findByRole('link', { name: 'Retail' });
        expect(retail).toHaveAttribute('href', '/sales/price-lists/pl-1');
        expect(within(retail.closest('tr')!).getByText('Default')).toBeInTheDocument();
    });

    it('shows the overall discount as a percent or as taka, right-aligned', async () => {
        render(<PriceListsPage />);
        const row = (await screen.findByText('Wholesale')).closest('tr')!;
        expect(within(row).getByText('7.5%').closest('td')).toHaveClass('text-end');
        const offer = screen.getByText('Eid Offer').closest('tr')!;
        expect(within(offer).getByText(formatBDT(50))).toBeInTheDocument();
    });

    it('sums the lists in the strip', async () => {
        render(<PriceListsPage />);
        const strip = await screen.findByRole('region', { name: 'Price list figures' });
        await waitFor(() => expect(within(strip).getByText('3')).toBeInTheDocument());
        expect(within(strip).getByText('Retail')).toBeInTheDocument(); // the default list
        expect(within(strip).getByText('210')).toBeInTheDocument(); // products priced
    });

    it('narrows rows and strip by the kind of overall discount', async () => {
        render(<PriceListsPage />);
        await screen.findByText('Wholesale');

        fireEvent.click(chip('Overall Discount'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Percentage' }));

        await waitFor(() => expect(screen.queryByText('Eid Offer')).not.toBeInTheDocument());
        expect(screen.getByText('Wholesale')).toBeInTheDocument();
        const strip = screen.getByRole('region', { name: 'Price list figures' });
        // The default list is filtered out, so the strip says there is none here.
        expect(within(strip).getByText('None')).toBeInTheDocument();
    });

    it('keeps delete off the default list and lists in use, and asks before deleting another', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        const confirmSpy = jest.spyOn(window, 'confirm');
        render(<PriceListsPage />);
        await screen.findByText('Eid Offer');

        expect(screen.getByRole('button', { name: 'The default list cannot be deleted' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Assigned to customer groups — reassign them first' })).toHaveAttribute(
            'aria-disabled',
            'true',
        );

        fireEvent.click(within(screen.getByText('Eid Offer').closest('tr')!).getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Delete Eid Offer?')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deletePriceList).toHaveBeenCalledWith('pl-3'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Price list deleted'));
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('shows the delete failure as a toast rather than an alert', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.deletePriceList.mockRejectedValueOnce(new Error('Still in use'));
        const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
        render(<PriceListsPage />);
        await screen.findByText('Eid Offer');

        fireEvent.click(within(screen.getByText('Eid Offer').closest('tr')!).getByRole('button', { name: 'Delete' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Still in use'));
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });
});
