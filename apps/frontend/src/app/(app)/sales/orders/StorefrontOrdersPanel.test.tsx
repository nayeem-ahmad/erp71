jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages, locale: 'en' }) };
}, { virtual: true });

import { render, screen, waitFor } from '@testing-library/react';
import StorefrontOrdersPanel from './StorefrontOrdersPanel';
import { fetchWithAuth } from '@/lib/api';

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

    // Web orders all belong to the online branch: on a shop's branch the panel
    // points there instead of showing an empty table.
    it('says where web orders are on a shop\'s branch, without asking for them', () => {
        render(<StorefrontOrdersPanel storeId="store-1" onShopBranch />);

        expect(screen.getByText(/Web orders belong to the Online Store branch/)).toBeInTheDocument();
        expect(fetchWithAuth).not.toHaveBeenCalled();
    });
});
