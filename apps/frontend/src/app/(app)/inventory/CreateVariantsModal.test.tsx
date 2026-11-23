import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreateVariantsModal from './CreateVariantsModal';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getProductFamily: jest.fn(),
        getProductFamilyOptionValues: jest.fn(),
        generateProductVariants: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks();
    (api.getProductFamilyOptionValues as jest.Mock).mockResolvedValue({ Size: ['S', 'M', 'L', 'XL'] });
});

describe('CreateVariantsModal', () => {
    it('makes one product per new size, the base joining as its own size', async () => {
        (api.generateProductVariants as jest.Mock).mockResolvedValue({ id: 'fam-1', name: 'Belt OAC' });
        const onSaved = jest.fn();
        render(
            <CreateVariantsModal
                base={{ id: 'p-m', name: 'Belt OAC M', sku: 'P1', price: 500 }}
                onClose={() => {}}
                onSaved={onSaved}
            />,
        );

        // The base's own size is read from its name.
        expect(screen.getByLabelText(/This product is — Size/)).toHaveValue('M');
        fireEvent.change(screen.getByLabelText(/Size — Values/), { target: { value: 'S, M, XL' } });

        // M is the base already, so only S and XL are listed.
        expect(screen.getByText('Belt OAC S')).toBeInTheDocument();
        expect(screen.getByText('Belt OAC XL')).toBeInTheDocument();
        expect(screen.queryByText('Belt OAC M')).not.toBeInTheDocument();
        expect(screen.getByLabelText('XL — SKU')).toHaveValue('P1-XL');

        fireEvent.change(screen.getByLabelText('XL — Price'), { target: { value: '650' } });
        fireEvent.change(screen.getByLabelText('XL — Opening stock'), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create 2 products' }));

        await waitFor(() => expect(api.generateProductVariants).toHaveBeenCalled());
        expect(api.generateProductVariants).toHaveBeenCalledWith({
            baseProductId: 'p-m',
            name: 'Belt OAC',
            optionNames: ['Size'],
            baseOptionValues: { Size: 'M' },
            variants: [
                { optionValues: { Size: 'S' }, sku: 'P1-S', price: 500, initialStock: 0 },
                { optionValues: { Size: 'XL' }, sku: 'P1-XL', price: 650, initialStock: 4 },
            ],
        });
        expect(toast.success).toHaveBeenCalledWith('Created 2 products in Belt OAC');
        expect(onSaved).toHaveBeenCalled();
    });

    it("adds to the base's family, leaving out the sizes it already has", async () => {
        (api.getProductFamily as jest.Mock).mockResolvedValue({
            id: 'fam-1',
            name: 'Belt OAC',
            option_names: ['Size'],
            members: [
                { id: 'p-s', name: 'Belt OAC S', option_values: { Size: 'S' } },
                { id: 'p-m', name: 'Belt OAC M', option_values: { Size: 'M' } },
            ],
        });
        render(
            <CreateVariantsModal
                base={{ id: 'p-s', name: 'Belt OAC S', sku: null, price: 500, family: { id: 'fam-1', name: 'Belt OAC', option_names: ['Size'] }, option_values: { Size: 'S' } }}
                onClose={() => {}}
                onSaved={() => {}}
            />,
        );
        await waitFor(() => expect(api.getProductFamily).toHaveBeenCalledWith('fam-1'));

        // A suggested size the shop already uses, added with one tap.
        fireEvent.click(await screen.findByRole('button', { name: '+ XL' }));
        fireEvent.change(screen.getByLabelText(/Size — Values/), { target: { value: 'M, XL' } });

        await waitFor(() => expect(screen.queryByText('Belt OAC M')).not.toBeInTheDocument());
        expect(screen.getByText('Belt OAC XL')).toBeInTheDocument();
        expect(screen.getByLabelText('XL — SKU')).toHaveValue('');
        expect(screen.queryByLabelText(/This product is/)).not.toBeInTheDocument();
    });

    it('says what to do when nothing would be made, and sends nothing', async () => {
        render(<CreateVariantsModal base={{ id: 'p', name: 'Cap', price: 100 }} onClose={() => {}} onSaved={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Create 0 products' }));
        expect(await screen.findAllByText('Enter values to see the products that will be created.')).not.toHaveLength(0);
        expect(api.generateProductVariants).not.toHaveBeenCalled();
    });
});
