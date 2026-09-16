'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WarehousesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getInventoryWarehouses: jest.fn(),
        createInventoryWarehouse: jest.fn(),
        updateInventoryWarehouse: jest.fn(),
        importWarehouses: jest.fn(),
        getStores: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/warehouses',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockWarehouses = [
    { id: 'wh-1', name: 'Main Warehouse', code: 'WH-001', is_active: true, is_default: true, store_id: 'store-1' },
    { id: 'wh-2', name: 'Overflow Shed', code: 'WH-002', is_active: false, is_default: false, store_id: 'store-1' },
    // Active and not the default: the only row that can be handed the default,
    // since an inactive warehouse is no use as one.
    { id: 'wh-3', name: 'Transit Depot', code: 'WH-003', is_active: true, is_default: false, store_id: 'store-2' },
];

const mockStores = [
    { id: 'store-1', name: 'Dhaka Branch' },
    { id: 'store-2', name: 'Chittagong Branch' },
];

function getApi() {
    return require('@/lib/api').api;
}

function getToast() {
    return require('@/lib/toast').toast;
}

describe('WarehousesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.getInventoryWarehouses.mockResolvedValue(mockWarehouses);
        api.getStores.mockResolvedValue(mockStores);
        api.createInventoryWarehouse.mockResolvedValue({ id: 'wh-3' });
        api.updateInventoryWarehouse.mockResolvedValue({});
    });

    it('lists every warehouse, active and inactive', async () => {
        render(<WarehousesPage />);
        await waitFor(() => {
            expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
            expect(screen.getByText('Overflow Shed')).toBeInTheDocument();
        });
    });

    it('shows each warehouse status', async () => {
        render(<WarehousesPage />);
        await waitFor(() => {
            // Two active rows, one inactive.
            expect(screen.getAllByText('Active')).toHaveLength(2);
            expect(screen.getByText('Inactive')).toBeInTheDocument();
        });
    });

    // The bug this page was split out to fix: the inactive row must offer a way back.
    // 'Activate' is matched exactly — 'Deactivate' contains it as a substring.
    it('offers Activate on an inactive warehouse and sends isActive true', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Overflow Shed'));

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        await waitFor(() => {
            expect(api.updateInventoryWarehouse).toHaveBeenCalledWith('wh-2', { isActive: true });
        });
    });

    it('does not offer Deactivate on the default warehouse', async () => {
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        // Only the active non-default row offers it; the default would strand
        // the store, so its row has no status action at all.
        expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(1);
    });

    it('surfaces a failed toggle as an error toast', async () => {
        const api = getApi();
        api.updateInventoryWarehouse.mockRejectedValue(new Error('Warehouse is inactive.'));
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Overflow Shed'));

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        await waitFor(() => {
            expect(getToast().error).toHaveBeenCalledWith('Warehouse is inactive.');
        });
    });

    it('reloads the list after a successful toggle', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Overflow Shed'));

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        await waitFor(() => {
            expect(api.getInventoryWarehouses).toHaveBeenCalledTimes(2);
        });
    });

    it('hands the default over to another active warehouse', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Transit Depot'));

        fireEvent.click(screen.getByRole('button', { name: /make default/i }));

        await waitFor(() => {
            expect(api.updateInventoryWarehouse).toHaveBeenCalledWith('wh-3', { isDefault: true });
        });
    });

    // Promoting a deactivated warehouse would leave the store defaulting to a
    // location it cannot move stock through.
    it('does not offer Make Default on an inactive warehouse', async () => {
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Overflow Shed'));

        // Only the one active non-default row offers it.
        expect(screen.getAllByRole('button', { name: /make default/i })).toHaveLength(1);
    });

    it('creates a warehouse with a store picked from the tenant list', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }));
        fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: 'Cold Store' } });
        fireEvent.change(screen.getByLabelText(/branch|store/i), { target: { value: 'store-2' } });
        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() => {
            expect(api.createInventoryWarehouse).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Cold Store', storeId: 'store-2' }),
            );
        });
    });

    it('rejects a blank name inline rather than calling the API', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^create$/i }));

        await waitFor(() => {
            expect(screen.getByText(/name is required/i)).toBeInTheDocument();
        });
        expect(api.createInventoryWarehouse).not.toHaveBeenCalled();
    });

    it('rejects a whitespace-only name inline rather than calling the API', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }));
        fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() => {
            expect(screen.getByText(/name is required/i)).toBeInTheDocument();
        });
        expect(api.createInventoryWarehouse).not.toHaveBeenCalled();
    });

    // A branch cannot hold two warehouses of the same name: the pickers on the
    // entry screens show the name alone, so a repeat makes "which one holds the
    // stock?" unanswerable.
    it('rejects a name the chosen branch already uses', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }));
        fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: 'Overflow Shed' } });
        fireEvent.change(screen.getByLabelText(/branch|store/i), { target: { value: 'store-1' } });
        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() => {
            expect(screen.getByText(/already exists in this branch/i)).toBeInTheDocument();
        });
        expect(api.createInventoryWarehouse).not.toHaveBeenCalled();
    });

    it('matches an existing name regardless of case or padding', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }));
        fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: '  overflow shed  ' } });
        fireEvent.change(screen.getByLabelText(/branch|store/i), { target: { value: 'store-1' } });
        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() => {
            expect(screen.getByText(/already exists in this branch/i)).toBeInTheDocument();
        });
        expect(api.createInventoryWarehouse).not.toHaveBeenCalled();
    });

    // Uniqueness is per branch, not per tenant: two branches each calling a
    // location "Godown" is normal, and the entry pickers are filtered to one.
    it('allows a name another branch already uses', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }));
        fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: 'Overflow Shed' } });
        fireEvent.change(screen.getByLabelText(/branch|store/i), { target: { value: 'store-2' } });
        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() => {
            expect(api.createInventoryWarehouse).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Overflow Shed', storeId: 'store-2' }),
            );
        });
    });

    it('lets a warehouse keep its own name while editing', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getAllByTitle(/edit/i)[0]);
        fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateInventoryWarehouse).toHaveBeenCalledWith(
                'wh-1',
                expect.objectContaining({ name: 'Main Warehouse' }),
            );
        });
    });

    it('rejects a rename onto a sibling warehouse in the same branch', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getAllByTitle(/edit/i)[0]);
        fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: 'Overflow Shed' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(screen.getByText(/already exists in this branch/i)).toBeInTheDocument();
        });
        expect(api.updateInventoryWarehouse).not.toHaveBeenCalled();
    });

    it('clears the name error once the field is edited again', async () => {
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^create$/i }));
        await waitFor(() => screen.getByText(/name is required/i));

        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'C' } });

        await waitFor(() => {
            expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument();
        });
    });

    it('renames an existing warehouse', async () => {
        const api = getApi();
        render(<WarehousesPage />);
        await waitFor(() => screen.getByText('Main Warehouse'));

        fireEvent.click(screen.getAllByTitle(/edit/i)[0]);
        fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: 'Central Warehouse' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateInventoryWarehouse).toHaveBeenCalledWith(
                'wh-1',
                expect.objectContaining({ name: 'Central Warehouse' }),
            );
        });
    });
});
