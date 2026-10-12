'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProductCostsPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getProductCosts: jest.fn(),
        getProductCostAdjustments: jest.fn(),
        createProductCostAdjustments: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/product-costs',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockPlan = { permissions: [] as string[], role: 'OWNER' as string | null };
jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: () => mockPlan,
}));

// Renders every cell, so the cost inputs and their buttons are on the page.
jest.mock('@/components/data-table', () => ({
    DataTable: ({ title, data, columns, emptyMessage }: { title: string; data: any[]; columns: any[]; emptyMessage: string }) => (
        <table aria-label={title}>
            <tbody>
                {data.length === 0 ? (
                    <tr><td>{emptyMessage}</td></tr>
                ) : data.map((row, index) => (
                    <tr key={index} data-testid={`${title}-row`}>
                        {columns.map((column, columnIndex) => (
                            <td key={columnIndex}>
                                {column.cell
                                    ? column.cell({
                                        row: { original: row },
                                        getValue: () => (column.accessorFn ? column.accessorFn(row) : row[column.accessorKey]),
                                    })
                                    : null}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    ),
}));

const uncostedRow = {
    product: { id: 'p1', name: 'Rice 5kg', sku: 'RICE-5' },
    onHand: 10,
    averageCost: null,
    priceListCost: null,
    effectiveCost: null,
    costBasis: 'UNCOSTED',
    stockValue: null,
    lastPurchaseCost: 455,
    lastPurchaseAt: '2026-09-01T00:00:00.000Z',
};

const costedRow = {
    product: { id: 'p2', name: 'Lentils 1kg', sku: 'DAL-1' },
    onHand: 12,
    averageCost: 80,
    priceListCost: null,
    effectiveCost: 80,
    costBasis: 'WEIGHTED_AVERAGE',
    stockValue: 960,
    lastPurchaseCost: 82,
    lastPurchaseAt: '2026-09-02T00:00:00.000Z',
};

function respond(items: any[], summary = { productCount: 40, uncostedCount: 9, uncostedInStockCount: 6 }) {
    (api.getProductCosts as jest.Mock).mockResolvedValue({
        items,
        pagination: { total: items.length, page: 1, limit: 50, pages: 1 },
        costingMethod: 'WEIGHTED_AVERAGE',
        summary,
    });
}

describe('ProductCostsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPlan.permissions = [];
        mockPlan.role = 'OWNER';
        (api.getProductCostAdjustments as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 0 });
        (api.createProductCostAdjustments as jest.Mock).mockResolvedValue({ adjusted: 1, adjustments: [] });
    });

    it('opens on the products holding stock with no cost, and says what that costs the shop', async () => {
        respond([uncostedRow]);

        render(<ProductCostsPage />);

        expect(await screen.findByText('Rice 5kg')).toBeInTheDocument();
        expect(api.getProductCosts).toHaveBeenCalledWith(expect.objectContaining({ status: 'UNCOSTED', inStockOnly: true, page: 1 }));
        expect(screen.getByText(/6 product\(s\) holding stock have no cost on file/)).toBeInTheDocument();
    });

    it('fills blanks from the last purchase price and saves them as opening costs, with no reason asked', async () => {
        respond([uncostedRow]);
        render(<ProductCostsPage />);
        await screen.findByText('Rice 5kg');

        fireEvent.click(screen.getByRole('button', { name: 'Fill blanks from last purchase' }));
        expect(screen.getByLabelText('New cost for Rice 5kg')).toHaveValue(455);

        fireEvent.click(screen.getByRole('button', { name: 'Save 1 cost(s)' }));
        expect(screen.getByText('1 have no cost on file yet. Theirs is recorded as an opening cost.')).toBeInTheDocument();
        expect(screen.queryByLabelText(/already have a cost/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save costs' }));

        await waitFor(() => expect(api.createProductCostAdjustments).toHaveBeenCalledWith({
            items: [{ productId: 'p1', unitCost: 455 }],
            reason: undefined,
            note: undefined,
        }));
    });

    it('makes a change to an existing cost say why before it is sent', async () => {
        respond([costedRow]);
        render(<ProductCostsPage />);
        await screen.findByText('Lentils 1kg');

        fireEvent.change(screen.getByLabelText('New cost for Lentils 1kg'), { target: { value: '60' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save 1 cost(s)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save costs' }));

        expect(await screen.findByText('Choose why the existing costs are changing.')).toBeInTheDocument();
        expect(api.createProductCostAdjustments).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText(/already have a cost/), { target: { value: 'WRITE_DOWN' } });
        fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'water damage' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save costs' }));

        await waitFor(() => expect(api.createProductCostAdjustments).toHaveBeenCalledWith({
            items: [{ productId: 'p2', unitCost: 60 }],
            reason: 'WRITE_DOWN',
            note: 'water damage',
        }));
    });

    it('shows the server refusal in the dialog and keeps what was typed', async () => {
        respond([uncostedRow]);
        (api.createProductCostAdjustments as jest.Mock).mockRejectedValue(new Error('Rice 5kg: An opening cost must be above zero.'));
        render(<ProductCostsPage />);
        await screen.findByText('Rice 5kg');

        fireEvent.change(screen.getByLabelText('New cost for Rice 5kg'), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save 1 cost(s)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save costs' }));

        expect(await screen.findByText('Rice 5kg: An opening cost must be above zero.')).toBeInTheDocument();
        expect(screen.getByLabelText('New cost for Rice 5kg')).toHaveValue(0);
    });

    it('is read-only without ADJUST_PRODUCT_COST', async () => {
        mockPlan.role = 'MANAGER';
        mockPlan.permissions = ['VIEW_FINANCIAL_REPORTS'];
        respond([uncostedRow]);

        render(<ProductCostsPage />);
        const table = await screen.findByRole('table', { name: 'Product Costs' });

        expect(within(table).queryByLabelText('New cost for Rice 5kg')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Save .* cost/ })).not.toBeInTheDocument();
        expect(screen.getByText(/Setting them needs the/)).toBeInTheDocument();
    });

    it('lets a member holding the permission edit without being the owner', async () => {
        mockPlan.role = 'MANAGER';
        mockPlan.permissions = ['ADJUST_PRODUCT_COST'];
        respond([uncostedRow]);

        render(<ProductCostsPage />);

        expect(await screen.findByLabelText('New cost for Rice 5kg')).toBeInTheDocument();
    });
});
