import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import InventorySettingsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getInventoryWarehouses: jest.fn(),
        getInventorySettings: jest.fn(),
        getInventoryReasons: jest.fn(),
        updateInventorySettings: jest.fn(),
        createInventoryWarehouse: jest.fn(),
        updateInventoryWarehouse: jest.fn(),
        createInventoryReason: jest.fn(),
        updateInventoryReason: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/inventory/settings'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

const mockWarehouses = [
    { id: 'wh-1', name: 'Main Warehouse', code: 'WH-001', is_active: true, is_default: true, store_id: 'store-1' },
    { id: 'wh-2', name: 'Secondary', code: 'WH-002', is_active: false, is_default: false, store_id: 'store-1' },
];

const mockSettings = {
    defaultProductWarehouse: { id: 'wh-1' },
    defaultPurchaseWarehouse: { id: 'wh-1' },
    defaultSalesWarehouse: { id: 'wh-1' },
    defaultShrinkageWarehouse: { id: 'wh-1' },
    defaultTransferSourceWarehouse: null,
    defaultTransferDestinationWarehouse: null,
    default_reorder_level: 10,
    default_safety_stock: 5,
    default_lead_time_days: 7,
    discrepancy_approval_threshold: 25,
};

const mockReasons = [
    { id: 'rsn-1', type: 'SHRINKAGE', code: 'SHR', label: 'Shrinkage', is_active: true },
    { id: 'rsn-2', type: 'DAMAGE', code: 'DMG', label: 'Damaged', is_active: true },
];

function getApi() {
    return require('@/lib/api').api;
}

describe('InventorySettingsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.getInventoryWarehouses.mockResolvedValue(mockWarehouses);
        api.getInventorySettings.mockResolvedValue(mockSettings);
        api.getInventoryReasons.mockResolvedValue(mockReasons);
        api.updateInventorySettings.mockResolvedValue({});
        api.createInventoryWarehouse.mockResolvedValue({ id: 'wh-3' });
        api.updateInventoryWarehouse.mockResolvedValue({});
        api.createInventoryReason.mockResolvedValue({ id: 'rsn-3' });
        api.updateInventoryReason.mockResolvedValue({});
    });

    it('renders the page heading', async () => {
        render(<InventorySettingsPage />);
        await waitFor(() => {
            expect(screen.getByText(/inventory settings/i)).toBeInTheDocument();
        });
    });

    it('calls all three API methods on mount', async () => {
        const api = getApi();
        render(<InventorySettingsPage />);
        await waitFor(() => {
            expect(api.getInventoryWarehouses).toHaveBeenCalledTimes(1);
            expect(api.getInventorySettings).toHaveBeenCalledTimes(1);
            expect(api.getInventoryReasons).toHaveBeenCalledTimes(1);
        });
    });

    it('shows inventory reasons', async () => {
        render(<InventorySettingsPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Shrinkage').length).toBeGreaterThan(0);
            expect(screen.getAllByText('Damaged').length).toBeGreaterThan(0);
        });
    });

    it('shows reorder level field', async () => {
        render(<InventorySettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('10')).toBeInTheDocument();
        });
    });

    it('shows Save Settings button', async () => {
        render(<InventorySettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
        });
    });

    it('calls updateInventorySettings when Save Settings clicked', async () => {
        const api = getApi();
        render(<InventorySettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /save changes/i }));
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => {
            expect(api.updateInventorySettings).toHaveBeenCalledTimes(1);
        });
    });

    it('shows success message after save', async () => {
        render(<InventorySettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /save changes/i }));
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => {
            expect(screen.getByText(/inventory settings updated/i)).toBeInTheDocument();
        });
    });

    // Warehouses moved to their own page at /inventory/warehouses; this page keeps
    // only the link to it, so the CRUD coverage lives in that page's test.
    it('links to the warehouses page', async () => {
        render(<InventorySettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('link', { name: /manage warehouses/i })).toHaveAttribute(
                'href',
                '/inventory/warehouses',
            );
        });
    });

    it('leaves selling without stock off when the tenant has not opted in', async () => {
        render(<InventorySettingsPage />);

        const toggle = await screen.findByRole('checkbox', { name: /allow selling without stock/i });
        expect(toggle).not.toBeChecked();
        expect(screen.getByText(/a sale is refused when a line asks for more/i)).toBeInTheDocument();
    });

    it('reflects the saved opt-in and sends it back on save', async () => {
        const api = getApi();
        api.getInventorySettings.mockResolvedValue({ ...mockSettings, allow_negative_stock: true });

        render(<InventorySettingsPage />);

        const toggle = await screen.findByRole('checkbox', { name: /allow selling without stock/i });
        expect(toggle).toBeChecked();
        // The help text under the control is what tells the shop what it just
        // switched on, so it has to follow the checkbox rather than the server.
        expect(screen.getByText(/the stock balance goes negative/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateInventorySettings).toHaveBeenCalledWith(
                expect.objectContaining({ allowNegativeStock: true }),
            );
        });
    });

    it('sends the opt-in once it is ticked', async () => {
        const api = getApi();
        render(<InventorySettingsPage />);

        const toggle = await screen.findByRole('checkbox', { name: /allow selling without stock/i });
        fireEvent.click(toggle);
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateInventorySettings).toHaveBeenCalledWith(
                expect.objectContaining({ allowNegativeStock: true }),
            );
        });
    });
});
