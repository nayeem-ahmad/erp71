import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GroupVariantsModal, { guessFromNames } from './GroupVariantsModal';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getProductFamily: jest.fn(),
        createProductFamily: jest.fn(),
        updateProductFamily: jest.fn(),
        deleteProductFamily: jest.fn(),
        getProductFamilyOptionValues: jest.fn().mockResolvedValue({ Size: ['S', 'M', 'L'] }),
        getProductsPaged: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const belts = [
    { id: 'p-s', name: 'Belt OAC S', sku: 'P1', price: 500 },
    { id: 'p-m', name: 'Belt OAC M', sku: 'P2', price: 500 },
];

beforeEach(() => {
    jest.clearAllMocks();
    (api.getProductFamilyOptionValues as jest.Mock).mockResolvedValue({ Size: ['S', 'M', 'L'] });
});

describe('guessFromNames', () => {
    it('reads the shared name and a trailing size', () => {
        expect(guessFromNames(belts)).toEqual({ name: 'Belt OAC', optionName: 'Size', values: { 'p-s': 'S', 'p-m': 'M' } });
    });

    it('falls back to the shared words and what is left of each name', () => {
        expect(
            guessFromNames([
                { id: 'a', name: 'Rice Miniket 5kg' },
                { id: 'b', name: 'Rice Miniket 25kg' },
            ]),
        ).toEqual({ name: 'Rice Miniket', optionName: 'Size', values: { a: '5kg', b: '25kg' } });
    });
});

describe('GroupVariantsModal', () => {
    it('prefills from the names and creates the family', async () => {
        (api.createProductFamily as jest.Mock).mockResolvedValue({ id: 'fam-1', name: 'Belt OAC' });
        const onSaved = jest.fn();
        const onClose = jest.fn();
        render(<GroupVariantsModal mode="create" products={belts} onClose={onClose} onSaved={onSaved} />);

        expect(screen.getByLabelText(/Name on the storefront/)).toHaveValue('Belt OAC');
        expect(screen.getByLabelText('Belt OAC S — Size')).toHaveValue('S');

        fireEvent.click(screen.getByRole('button', { name: 'Group as variants' }));

        await waitFor(() => expect(api.createProductFamily).toHaveBeenCalled());
        expect(api.createProductFamily).toHaveBeenCalledWith({
            name: 'Belt OAC',
            description: '',
            imageUrl: '',
            isFeatured: false,
            optionNames: ['Size'],
            members: [
                { productId: 'p-s', optionValues: { Size: 'S' } },
                { productId: 'p-m', optionValues: { Size: 'M' } },
            ],
        });
        expect(toast.success).toHaveBeenCalledWith('Grouped 2 products as Belt OAC');
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('marks two products with the same options inline and does not save', async () => {
        render(<GroupVariantsModal mode="create" products={belts} onClose={() => {}} onSaved={() => {}} />);
        fireEvent.change(screen.getByLabelText('Belt OAC M — Size'), { target: { value: 's' } });

        fireEvent.click(screen.getByRole('button', { name: 'Group as variants' }));

        expect(await screen.findAllByText('Same options as another product')).toHaveLength(2);
        expect(api.createProductFamily).not.toHaveBeenCalled();
    });

    it('loads a family for editing and ungroups it after confirming', async () => {
        (api.getProductFamily as jest.Mock).mockResolvedValue({
            id: 'fam-1',
            name: 'Belt OAC',
            description: null,
            image_url: null,
            images_gallery: [],
            option_names: ['Size'],
            is_featured: true,
            members: [
                { id: 'p-s', name: 'Belt OAC S', sku: 'P1', price: 500, image_url: null, option_values: { Size: 'S' }, stock_quantity: 1 },
            ],
        });
        (api.deleteProductFamily as jest.Mock).mockResolvedValue({ id: 'fam-1' });
        const onSaved = jest.fn();
        render(<GroupVariantsModal mode="edit" familyId="fam-1" onClose={() => {}} onSaved={onSaved} />);

        await waitFor(() => expect(screen.getByLabelText(/Name on the storefront/)).toHaveValue('Belt OAC'));
        fireEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
        const confirm = await screen.findAllByRole('button', { name: 'Ungroup' });
        fireEvent.click(confirm[confirm.length - 1]);

        await waitFor(() => expect(api.deleteProductFamily).toHaveBeenCalledWith('fam-1'));
        expect(onSaved).toHaveBeenCalled();
    });

    it('finds products in no group and adds them, their size read from the name', async () => {
        (api.getProductFamily as jest.Mock).mockResolvedValue({
            id: 'fam-1',
            name: 'Belt OAC',
            description: null,
            image_url: null,
            images_gallery: [],
            option_names: ['Size'],
            is_featured: false,
            members: [{ id: 'p-s', name: 'Belt OAC S', sku: 'P1', price: 500, image_url: null, option_values: { Size: 'S' }, stock_quantity: 1 }],
        });
        (api.getProductsPaged as jest.Mock).mockResolvedValue({
            items: [
                { id: 'p-s', name: 'Belt OAC S', sku: 'P1', price: 500 },
                { id: 'p-xl', name: 'Belt OAC XL', sku: 'P3', price: 650 },
            ],
        });
        (api.updateProductFamily as jest.Mock).mockResolvedValue({});
        render(<GroupVariantsModal mode="edit" familyId="fam-1" onClose={() => {}} onSaved={() => {}} />);

        fireEvent.change(await screen.findByLabelText('Add products'), { target: { value: 'belt' } });
        await waitFor(() =>
            expect(api.getProductsPaged).toHaveBeenCalledWith({ search: 'belt', ungrouped: true, limit: 10 }),
        );
        // The group's own S is not offered again.
        const xl = await screen.findByText('Belt OAC XL');
        expect(screen.getAllByText('Belt OAC S')).toHaveLength(1);
        fireEvent.click(xl.closest('li')!.querySelector('button')!);

        expect(screen.getByLabelText('Belt OAC XL — Size')).toHaveValue('XL');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(api.updateProductFamily).toHaveBeenCalledWith('fam-1', expect.objectContaining({
                members: [
                    { productId: 'p-s', optionValues: { Size: 'S' } },
                    { productId: 'p-xl', optionValues: { Size: 'XL' } },
                ],
            })),
        );
    });
});

