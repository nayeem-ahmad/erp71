jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages, locale: 'en' }) };
}, { virtual: true });

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StorefrontOrdersPanel from './StorefrontOrdersPanel';
import { fetchWithAuth } from '@/lib/api';

// Desktop width, where the secondary columns (items, delivery address) show.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

describe('StorefrontOrdersPanel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (fetchWithAuth as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 0 });
    });

    it('lists the web orders of the branch the page shows', async () => {
        render(<StorefrontOrdersPanel storeId="online-store" />);

        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledWith('/storefront/orders?page=1&limit=20&storeId=online-store');
        });
    });

    it('shows the web orders in the standard table and changes a status in place', async () => {
        (fetchWithAuth as jest.Mock).mockImplementation((url: string) =>
            url.startsWith('/storefront/orders?')
                ? Promise.resolve({
                      items: [
                          {
                              id: 'web-order-1',
                              customerName: 'Rahima Begum',
                              customerEmail: 'rahima@example.com',
                              customerPhone: '01711111111',
                              totalAmount: '1200',
                              status: 'PENDING',
                              notes: null,
                              deliveryAddress: 'House 4, Road 2',
                              deliveryArea: 'Dhanmondi',
                              created_at: '2026-11-01T10:00:00.000Z',
                              items: [{ id: 'l1', quantity: 2, priceAtOrder: '600', product: { id: 'p1', name: 'Rice 5kg' } }],
                          },
                      ],
                      total: 1,
                      page: 1,
                      limit: 20,
                      pages: 1,
                  })
                : Promise.resolve({}),
        );
        render(<StorefrontOrdersPanel storeId="online-store" />);

        expect(await screen.findByText('Rahima Begum')).toBeInTheDocument();
        expect(screen.getByText('Rice 5kg × 2')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'CONFIRMED' } });

        await waitFor(() =>
            expect(fetchWithAuth).toHaveBeenCalledWith(
                '/storefront/orders/web-order-1/status',
                expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'CONFIRMED' }) }),
            ),
        );
    });

    // Web orders all belong to the online branch: on a shop's branch the panel
    // points there instead of showing an empty table.
    it('says where web orders are on a shop\'s branch, without asking for them', () => {
        render(<StorefrontOrdersPanel storeId="store-1" onShopBranch />);

        expect(screen.getByText(/Web orders belong to the Online Store branch/)).toBeInTheDocument();
        expect(fetchWithAuth).not.toHaveBeenCalled();
    });
});
