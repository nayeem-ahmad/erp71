import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssignVariantModal from './AssignVariantModal';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getProductFamilies: jest.fn(),
        getProductFamilyOptionValues: jest.fn(),
        updateProduct: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const belt = {
    id: 'fam-1',
    name: 'Belt OAC',
    description: null,
    image_url: null,
    images_gallery: [],
    option_names: ['Size'],
    is_featured: false,
    members: [{ id: 'p-s', name: 'Belt OAC S', sku: null, price: 500, image_url: null, option_values: { Size: 'S' }, stock_quantity: 1 }],
};

beforeEach(() => {
    jest.clearAllMocks();
    (api.getProductFamilyOptionValues as jest.Mock).mockResolvedValue({});
});

describe('AssignVariantModal', () => {
    it('adds the product to a group, its size read from its name', async () => {
        (api.getProductFamilies as jest.Mock).mockResolvedValue([belt]);
        (api.updateProduct as jest.Mock).mockResolvedValue({ family: { name: 'Belt OAC' } });
        const onSaved = jest.fn();
        render(<AssignVariantModal product={{ id: 'p-xl', name: 'Belt OAC XL' }} onClose={() => {}} onSaved={onSaved} />);

        fireEvent.click(await screen.findByRole('button', { name: /Belt OAC/ }));
        expect(screen.getByLabelText('Size')).toHaveValue('XL');
        expect(screen.getByText('Already in the group: S')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(api.updateProduct).toHaveBeenCalledWith('p-xl', { variant: { familyId: 'fam-1', optionValues: { Size: 'XL' } } }),
        );
        expect(toast.success).toHaveBeenCalledWith('Belt OAC XL added to Belt OAC');
        expect(onSaved).toHaveBeenCalled();
    });

    it('shows a size the group already has beside the field, and saves nothing', async () => {
        (api.getProductFamilies as jest.Mock).mockResolvedValue([belt]);
        render(<AssignVariantModal product={{ id: 'p-2', name: 'Belt OAC Small' }} onClose={() => {}} onSaved={() => {}} />);

        fireEvent.click(await screen.findByRole('button', { name: /Belt OAC/ }));
        fireEvent.change(screen.getByLabelText('Size'), { target: { value: 's' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/Each variant needs its own combination/)).toBeInTheDocument();
        expect(api.updateProduct).not.toHaveBeenCalled();
    });

    it('starts a new group when the shop has none yet', async () => {
        (api.getProductFamilies as jest.Mock).mockResolvedValue([]);
        (api.updateProduct as jest.Mock).mockResolvedValue({ family: { name: 'Knee Cap' } });
        render(<AssignVariantModal product={{ id: 'p-k', name: 'Knee Cap XL' }} onClose={() => {}} onSaved={() => {}} />);

        await waitFor(() => expect(screen.getByLabelText(/Name on the storefront/)).toHaveValue('Knee Cap'));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(api.updateProduct).toHaveBeenCalledWith('p-k', {
                variant: { newFamilyName: 'Knee Cap', optionNames: ['Size'], optionValues: { Size: 'XL' } },
            }),
        );
    });
});
