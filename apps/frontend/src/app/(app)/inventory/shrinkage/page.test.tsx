import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import InventoryShrinkagePage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getInventoryShrinkage: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getInventoryReasons: jest.fn(),
        getProducts: jest.fn(),
        createInventoryShrinkage: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/inventory/shrinkage'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

const mockWarehouses = [{ id: 'wh-1', name: 'Main Warehouse', code: 'WH-001', is_active: true, store_id: 'store-1' }];

// Both catalogues come back from one unfiltered call; the page narrows by type.
const mockReasons = [
    { id: 'rsn-loss', type: 'SHRINKAGE', code: 'THEFT', label: 'Theft', is_active: true },
    { id: 'rsn-found', type: 'FOUND', code: 'MISCOUNT', label: 'Miscount', is_active: true },
];

const mockProducts = [{ id: 'prod-1', name: 'Rice 5kg' }];

function getApi() {
    return require('@/lib/api').api;
}

async function fillEntry({ notes }: { notes: string }) {
    fireEvent.change(screen.getByLabelText(/warehouse/i), { target: { value: 'wh-1' } });
    fireEvent.change(screen.getByLabelText(/^reason/i), { target: { value: 'rsn-loss' } });
    fireEvent.change(screen.getByLabelText(/select product/i), { target: { value: 'prod-1' } });
    if (notes) fireEvent.change(screen.getByLabelText(/^notes/i), { target: { value: notes } });
}

describe('InventoryShrinkagePage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.getInventoryShrinkage.mockResolvedValue([]);
        api.getInventoryWarehouses.mockResolvedValue(mockWarehouses);
        api.getInventoryReasons.mockResolvedValue(mockReasons);
        api.getProducts.mockResolvedValue(mockProducts);
        api.createInventoryShrinkage.mockResolvedValue({ id: 'shr-1' });
    });

    it('refuses to post without a note, and says so on the field', async () => {
        const api = getApi();
        render(<InventoryShrinkagePage />);
        await waitFor(() => expect(api.getInventoryReasons).toHaveBeenCalled());

        await fillEntry({ notes: '' });
        fireEvent.click(screen.getByRole('button', { name: /post shrinkage/i }));

        await waitFor(() => expect(screen.getByText('A note is required.')).toBeInTheDocument());
        expect(api.createInventoryShrinkage).not.toHaveBeenCalled();
    });

    // A space bar is not evidence. The server trims before validating too.
    it('treats a whitespace-only note as no note', async () => {
        const api = getApi();
        render(<InventoryShrinkagePage />);
        await waitFor(() => expect(api.getInventoryReasons).toHaveBeenCalled());

        await fillEntry({ notes: '   ' });
        fireEvent.click(screen.getByRole('button', { name: /post shrinkage/i }));

        await waitFor(() => expect(screen.getByText('A note is required.')).toBeInTheDocument());
        expect(api.createInventoryShrinkage).not.toHaveBeenCalled();
    });

    it('refuses to post without a reason', async () => {
        const api = getApi();
        render(<InventoryShrinkagePage />);
        await waitFor(() => expect(api.getInventoryReasons).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/warehouse/i), { target: { value: 'wh-1' } });
        fireEvent.change(screen.getByLabelText(/select product/i), { target: { value: 'prod-1' } });
        fireEvent.change(screen.getByLabelText(/^notes/i), { target: { value: 'Crushed in bay 3' } });
        fireEvent.click(screen.getByRole('button', { name: /post shrinkage/i }));

        await waitFor(() => expect(screen.getByText('Select a reason.')).toBeInTheDocument());
        expect(api.createInventoryShrinkage).not.toHaveBeenCalled();
    });

    it('posts a write-off once every required field is filled', async () => {
        const api = getApi();
        render(<InventoryShrinkagePage />);
        await waitFor(() => expect(api.getInventoryReasons).toHaveBeenCalled());

        await fillEntry({ notes: 'Crushed by the forklift in bay 3' });
        fireEvent.click(screen.getByRole('button', { name: /post shrinkage/i }));

        await waitFor(() =>
            expect(api.createInventoryShrinkage).toHaveBeenCalledWith(
                expect.objectContaining({
                    direction: 'LOSS',
                    reasonId: 'rsn-loss',
                    notes: 'Crushed by the forklift in bay 3',
                }),
            ),
        );
    });

    // "Theft" can never explain a surplus, so switching direction must swap the
    // catalogue outright rather than add to it.
    it('swaps the reason catalogue when the entry type changes', async () => {
        const api = getApi();
        render(<InventoryShrinkagePage />);
        await waitFor(() => expect(api.getInventoryReasons).toHaveBeenCalled());

        const reasonSelect = screen.getByLabelText(/^reason/i);
        expect(within(reasonSelect).getByText('Theft')).toBeInTheDocument();
        expect(within(reasonSelect).queryByText('Miscount')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^entry type/i), { target: { value: 'FOUND' } });

        await waitFor(() => expect(within(reasonSelect).getByText('Miscount')).toBeInTheDocument());
        expect(within(reasonSelect).queryByText('Theft')).not.toBeInTheDocument();
    });

    it('posts found stock as its own direction', async () => {
        const api = getApi();
        render(<InventoryShrinkagePage />);
        await waitFor(() => expect(api.getInventoryReasons).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/^entry type/i), { target: { value: 'FOUND' } });
        fireEvent.change(screen.getByLabelText(/warehouse/i), { target: { value: 'wh-1' } });
        fireEvent.change(screen.getByLabelText(/^reason/i), { target: { value: 'rsn-found' } });
        fireEvent.change(screen.getByLabelText(/select product/i), { target: { value: 'prod-1' } });
        fireEvent.change(screen.getByLabelText(/^notes/i), { target: { value: 'Two cartons behind the rack' } });
        fireEvent.click(screen.getByRole('button', { name: /post found stock/i }));

        await waitFor(() =>
            expect(api.createInventoryShrinkage).toHaveBeenCalledWith(
                expect.objectContaining({ direction: 'FOUND', reasonId: 'rsn-found' }),
            ),
        );
    });

    // Switching direction after picking a reason must not carry the old one
    // across — the server rejects it, and the form should never send it.
    it('clears a reason left over from the other direction', async () => {
        const api = getApi();
        render(<InventoryShrinkagePage />);
        await waitFor(() => expect(api.getInventoryReasons).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/^reason/i), { target: { value: 'rsn-loss' } });
        fireEvent.change(screen.getByLabelText(/^entry type/i), { target: { value: 'FOUND' } });

        expect((screen.getByLabelText(/^reason/i) as HTMLSelectElement).value).toBe('');
    });
});
