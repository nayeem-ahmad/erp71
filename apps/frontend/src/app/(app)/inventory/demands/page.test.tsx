'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProductDemandsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getProductDemands: jest.fn(),
        createProductDemand: jest.fn(),
        updateProductDemand: jest.fn(),
        submitProductDemand: jest.fn(),
        cancelProductDemand: jest.fn(),
        reviewProductDemand: jest.fn(),
        fulfilProductDemand: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getProducts: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/demands',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const tenantState = {
    planCode: 'pro',
    features: {},
    dashboardPreference: 'AUTO',
    permissions: ['CREATE_PRODUCT_DEMAND', 'APPROVE_PRODUCT_DEMAND'],
    role: 'MANAGER',
    ready: true,
};

jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: () => tenantState,
}));

const warehouses = [
    { id: 'wh-1', name: 'Main Warehouse', is_active: true, is_default: true },
    { id: 'wh-2', name: 'Gulshan Store', is_active: true, is_default: false },
];

const products = [
    { id: 'prod-1', name: 'Rice 5kg' },
    { id: 'prod-2', name: 'Cooking Oil 1L' },
];

const draftDemand = {
    id: 'demand-1',
    demand_number: 'PD-00001',
    status: 'DRAFT',
    priority: 'HIGH',
    needed_by: '2026-09-01T00:00:00.000Z',
    notes: 'Festival stock',
    review_note: null,
    fulfilment_note: null,
    reviewed_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    warehouse: { id: 'wh-1', name: 'Main Warehouse' },
    items: [
        {
            id: 'item-1', product_id: 'prod-1', quantity_requested: 20,
            quantity_approved: null, note: null, product: { id: 'prod-1', name: 'Rice 5kg', sku: 'R5' },
        },
    ],
};

const submittedDemand = {
    ...draftDemand,
    id: 'demand-2',
    demand_number: 'PD-00002',
    status: 'SUBMITTED',
    priority: 'URGENT',
    items: [
        {
            id: 'item-2', product_id: 'prod-2', quantity_requested: 12,
            quantity_approved: null, note: null, product: { id: 'prod-2', name: 'Cooking Oil 1L', sku: 'O1' },
        },
    ],
};

const openDetailFor = async (demandNumber: string) => {
    const row = (await screen.findByText(demandNumber)).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'View' }));
};

describe('ProductDemandsPage', () => {
    let api: any;

    beforeEach(() => {
        ({ api } = require('@/lib/api'));
        api.getProductDemands.mockResolvedValue([draftDemand, submittedDemand]);
        api.getInventoryWarehouses.mockResolvedValue(warehouses);
        api.getProducts.mockResolvedValue(products);
        api.createProductDemand.mockResolvedValue({ id: 'demand-3' });
        api.updateProductDemand.mockResolvedValue({});
        api.submitProductDemand.mockResolvedValue({});
        api.cancelProductDemand.mockResolvedValue({});
        api.reviewProductDemand.mockResolvedValue({});
        api.fulfilProductDemand.mockResolvedValue({});
        tenantState.permissions = ['CREATE_PRODUCT_DEMAND', 'APPROVE_PRODUCT_DEMAND'];
        tenantState.role = 'MANAGER';
    });

    afterEach(() => jest.clearAllMocks());

    it('lists the demands returned by the API', async () => {
        render(<ProductDemandsPage />);

        expect(await screen.findByText('PD-00001')).toBeInTheDocument();
        expect(screen.getByText('PD-00002')).toBeInTheDocument();
        // The product column carries `hideOnMobile`, and jsdom reports the
        // narrow viewport — so assert on the status, which is always shown.
        // Scoped to the row: the same words are also filter options.
        const row = screen.getByText('PD-00001').closest('tr') as HTMLElement;
        expect(within(row).getByText('Draft')).toBeInTheDocument();
        expect(within(row).getByText('High')).toBeInTheDocument();
    });

    it('passes the status filter through to the API', async () => {
        render(<ProductDemandsPage />);
        await screen.findByText('PD-00001');

        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'SUBMITTED' } });

        await waitFor(() => {
            expect(api.getProductDemands).toHaveBeenLastCalledWith(
                expect.objectContaining({ status: 'SUBMITTED' }),
            );
        });
    });

    it('narrows to the caller’s own demands when "Only mine" is ticked', async () => {
        render(<ProductDemandsPage />);
        await screen.findByText('PD-00001');

        fireEvent.click(screen.getByLabelText('Only mine'));

        await waitFor(() => {
            expect(api.getProductDemands).toHaveBeenLastCalledWith(
                expect.objectContaining({ mine: true }),
            );
        });
    });

    it('creates a submitted demand from the new-demand form', async () => {
        render(<ProductDemandsPage />);
        await screen.findByText('PD-00001');

        fireEvent.click(screen.getByRole('button', { name: /New Demand/ }));
        // The default warehouse is preselected, so only the line needs filling.
        fireEvent.change(screen.getByLabelText(/^Product/), { target: { value: 'prod-1' } });
        fireEvent.change(screen.getByLabelText(/^Quantity/), { target: { value: '6' } });
        fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));

        await waitFor(() => {
            expect(api.createProductDemand).toHaveBeenCalledWith(
                expect.objectContaining({
                    warehouseId: 'wh-1',
                    status: 'SUBMITTED',
                    items: [{ productId: 'prod-1', quantity: 6, note: undefined }],
                }),
            );
        });
    });

    it('refuses to save a demand with no product line', async () => {
        render(<ProductDemandsPage />);
        await screen.findByText('PD-00001');

        fireEvent.click(screen.getByRole('button', { name: /New Demand/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }));

        expect(await screen.findByText('Add at least one product.')).toBeInTheDocument();
        expect(api.createProductDemand).not.toHaveBeenCalled();
    });

    it('approves a submitted demand with the edited quantity', async () => {
        render(<ProductDemandsPage />);
        await openDetailFor('PD-00002');

        fireEvent.change(await screen.findByLabelText('Approved — Cooking Oil 1L'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        await waitFor(() => {
            expect(api.reviewProductDemand).toHaveBeenCalledWith('demand-2', {
                status: 'APPROVED',
                reviewNote: undefined,
                items: [{ productId: 'prod-2', quantityApproved: 5 }],
            });
        });
    });

    it('rejects a submitted demand with the approver note', async () => {
        render(<ProductDemandsPage />);
        await openDetailFor('PD-00002');

        fireEvent.change(await screen.findByLabelText('Approver Note'), { target: { value: 'No budget' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

        await waitFor(() => {
            expect(api.reviewProductDemand).toHaveBeenCalledWith('demand-2', {
                status: 'REJECTED',
                reviewNote: 'No budget',
            });
        });
    });

    it('submits a draft from its detail panel', async () => {
        render(<ProductDemandsPage />);
        await openDetailFor('PD-00001');

        fireEvent.click(await screen.findByRole('button', { name: 'Submit for Approval' }));

        await waitFor(() => expect(api.submitProductDemand).toHaveBeenCalledWith('demand-1'));
    });

    it('hides the approve and reject actions from a user without the permission', async () => {
        tenantState.permissions = ['CREATE_PRODUCT_DEMAND'];
        render(<ProductDemandsPage />);
        await openDetailFor('PD-00002');

        expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });

    it('hides the new-demand action from a user who cannot raise one', async () => {
        tenantState.permissions = ['APPROVE_PRODUCT_DEMAND'];
        render(<ProductDemandsPage />);
        await screen.findByText('PD-00001');

        expect(screen.queryByRole('button', { name: /New Demand/ })).not.toBeInTheDocument();
    });
});
