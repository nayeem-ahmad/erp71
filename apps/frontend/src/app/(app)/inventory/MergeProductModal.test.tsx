import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MergeProductModal from './MergeProductModal';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getProductsPaged: jest.fn(),
        previewProductMerge: jest.fn(),
        mergeProduct: jest.fn(),
    },
}));
jest.mock('@/lib/i18n', () => ({
    useI18n: () => ({
        t: {
            inventory: {
                merge: {
                    pickTitle: 'Merge into an existing product',
                    pickHelper: 'Pick the product that should remain.',
                    searchPlaceholder: 'Search products…',
                    cannotUndo: 'This cannot be undone.',
                    copyHeading: 'Copy onto the kept product',
                    submit: 'Merge product',
                    cancel: 'Cancel',
                    absorbing: 'Absorbing {name}',
                    warning: '{name} will be removed. {sales} sales and {purchases} purchases will move onto this product.',
                    stockLine: 'Stock {target} + {source} → {combined}',
                    costLine: 'Avg cost {cost}',
                    success: 'Merged into {name}',
                    failed: 'Could not merge products',
                    fields: { name: 'Name', sku: 'SKU', price: 'Price' },
                },
            },
        },
        fmt: (s: string, vars: Record<string, unknown>) =>
            s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')),
    }),
}));

beforeEach(() => {
    jest.clearAllMocks();
});

it('shows the keeper as the title after a preview and leaves copy toggles off', async () => {
    (api.getProductsPaged as jest.Mock).mockResolvedValue({ items: [{ id: 'tgt', name: 'Napa 500mg' }], total: 1, page: 1, limit: 10, pages: 1 });
    (api.previewProductMerge as jest.Mock).mockResolvedValue({
        source: { id: 'src', name: 'Napa Extra 500mg' },
        target: { id: 'tgt', name: 'Napa 500mg' },
        fields: [{ key: 'name', sourceValue: 'Napa Extra 500mg', targetValue: 'Napa 500mg' }],
        stock: [{ warehouseId: 'w', warehouseName: 'Main', sourceQty: 8, targetQty: 40, combinedQty: 48 }],
        cost: { combined: { avgCost: 12.55, qtyOnHand: 48 } },
        counts: { saleLines: 12, purchaseLines: 3 },
        folds: [],
        blockers: [],
    });
    render(<MergeProductModal isOpen source={{ id: 'src', name: 'Napa Extra 500mg' }} onClose={() => {}} onMerged={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search products…'), { target: { value: 'Napa' } });
    await waitFor(() => screen.getByText('Napa 500mg'));
    fireEvent.click(screen.getByText('Napa 500mg'));
    await waitFor(() => screen.getByRole('heading', { name: 'Napa 500mg' }));
    expect(screen.getByText(/Napa Extra 500mg will be removed/)).toBeInTheDocument();
    expect(screen.getByText(/Stock 40 \+ 8 → 48/)).toBeInTheDocument();
    const nameToggle = screen.getByRole('checkbox', { name: /Name/ });
    expect(nameToggle).not.toBeChecked();
});

it('disables Merge product when preview returns a blocker', async () => {
    (api.getProductsPaged as jest.Mock).mockResolvedValue({ items: [{ id: 'tgt', name: 'B' }], total: 1, page: 1, limit: 10, pages: 1 });
    (api.previewProductMerge as jest.Mock).mockResolvedValue({
        source: { id: 'src', name: 'A' },
        target: { id: 'tgt', name: 'B' },
        fields: [],
        stock: [],
        cost: { combined: { avgCost: null, qtyOnHand: 0 } },
        counts: { saleLines: 0, purchaseLines: 0 },
        folds: [],
        blockers: [{ code: 'TYPE_MISMATCH', message: 'Cannot merge GOODS into SERVICE' }],
    });
    render(<MergeProductModal isOpen source={{ id: 'src', name: 'A' }} onClose={() => {}} onMerged={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search products…'), { target: { value: 'B' } });
    await waitFor(() => screen.getByText('B'));
    fireEvent.click(screen.getByText('B'));
    await waitFor(() => screen.getByText('Cannot merge GOODS into SERVICE'));
    expect(screen.getByRole('button', { name: 'Merge product' })).toBeDisabled();
});
