import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AddProjectCostModal from './AddProjectCostModal';
import IssueMaterialsModal from './IssueMaterialsModal';

jest.mock('@/lib/api', () => ({
    api: {
        getProjectCostSources: jest.fn(),
        addProjectCost: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        searchProductsByQuantity: jest.fn(),
        issueProjectMaterials: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };

describe('AddProjectCostModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getProjectCostSources.mockResolvedValue([
            { id: 'pi-1', productName: 'Trucking', purchaseNumber: 'PUR-1', supplierName: 'Hauliers', purchaseDate: '2026-08-01', lineTotal: 1000, remainingAmount: 600 },
        ]);
        api.addProjectCost.mockResolvedValue({ id: 'c1' });
    });

    it('draws on a bill line, offering what is left on it', async () => {
        const onSaved = jest.fn();
        render(<AddProjectCostModal projectId="p1" onClose={jest.fn()} onSaved={onSaved} />);

        fireEvent.change(await screen.findByLabelText('From a bill (optional)'), { target: { value: 'pi-1' } });
        expect(screen.getByLabelText('Amount')).toHaveValue(600);
        expect(screen.getByLabelText('Category')).toHaveValue('SERVICES');

        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(api.addProjectCost).toHaveBeenCalledWith('p1', expect.objectContaining({
                amount: 250, category: 'SERVICES', sourcePurchaseItemId: 'pi-1', description: 'Trucking · Hauliers',
            })),
        );
        expect(onSaved).toHaveBeenCalled();
    });

    it('will not save more than is left on the line', async () => {
        render(<AddProjectCostModal projectId="p1" onClose={jest.fn()} onSaved={jest.fn()} />);

        fireEvent.change(await screen.findByLabelText('From a bill (optional)'), { target: { value: 'pi-1' } });
        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '601' } });

        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });
});

describe('IssueMaterialsModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        api.getInventoryWarehouses.mockResolvedValue([{ id: 'wh-1', name: 'Main', is_active: true }]);
        api.searchProductsByQuantity.mockResolvedValue([
            { id: 'cement', name: 'Cement', type: 'GOODS', stocks: [] },
            { id: 'svc', name: 'Transport service', type: 'SERVICE', stocks: [] },
        ]);
        api.issueProjectMaterials.mockResolvedValue({ id: 'iss-1' });
    });

    afterEach(() => jest.useRealTimers());

    it('issues the products picked, from the only warehouse, leaving services out of the search', async () => {
        const onSaved = jest.fn();
        render(<IssueMaterialsModal projectId="p1" onClose={jest.fn()} onSaved={onSaved} />);

        await waitFor(() => expect(screen.getByLabelText('Warehouse')).toHaveValue('wh-1'));
        fireEvent.change(screen.getByLabelText('Add a product'), { target: { value: 'ce' } });
        jest.advanceTimersByTime(350);

        fireEvent.click(await screen.findByRole('button', { name: /Cement/ }));
        expect(screen.queryByText('Transport service')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Quantity — Cement'), { target: { value: '10' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Issue materials' }).at(-1)!);

        await waitFor(() =>
            expect(api.issueProjectMaterials).toHaveBeenCalledWith('p1', expect.objectContaining({
                warehouseId: 'wh-1',
                items: [{ productId: 'cement', quantity: 10 }],
            })),
        );
        expect(onSaved).toHaveBeenCalled();
    });

    it('needs at least one product', async () => {
        render(<IssueMaterialsModal projectId="p1" onClose={jest.fn()} onSaved={jest.fn()} />);

        await waitFor(() => expect(screen.getByLabelText('Warehouse')).toHaveValue('wh-1'));

        expect(screen.getByText('Add at least one product.')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Issue materials' }).at(-1)).toBeDisabled();
    });
});
