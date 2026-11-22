import { act, fireEvent, render, screen } from '@testing-library/react';
import PriceCheckerPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { priceCheck: jest.fn() } }));

const PRODUCT = {
    id: 'p1', name: 'Teer Soyabean Oil 5L', sku: '8941100500019', price: 920, compareAtPrice: 950, unitType: 'none',
    imageUrl: null, brand: 'Teer', group: 'Oil', totalQuantity: 14,
    branches: [{ storeId: 's1', storeName: 'Mirpur', quantity: 14, warehouses: [{ warehouseId: 'w1', name: 'Main', quantity: 14 }] }],
};

describe('PriceCheckerPage', () => {
    it('looks a scanned code up on Enter and shows price and stock', async () => {
        (api.priceCheck as jest.Mock).mockResolvedValue({ exact: true, products: [PRODUCT] });
        render(<PriceCheckerPage />);
        const box = screen.getByLabelText(/Barcode, SKU or product name/);
        fireEvent.change(box, { target: { value: '8941100500019' } });
        await act(async () => {
            fireEvent.submit(box.closest('form')!);
        });
        expect(api.priceCheck).toHaveBeenCalledWith('8941100500019');
        expect(await screen.findByText('Teer Soyabean Oil 5L')).toBeInTheDocument();
        expect(screen.getByText('In stock')).toBeInTheDocument();
        expect(screen.getByText('Mirpur')).toBeInTheDocument();
    });

    it('says so when nothing matches', async () => {
        (api.priceCheck as jest.Mock).mockResolvedValue({ exact: false, products: [] });
        render(<PriceCheckerPage />);
        const box = screen.getByLabelText(/Barcode, SKU or product name/);
        fireEvent.change(box, { target: { value: 'zzz' } });
        await act(async () => {
            fireEvent.submit(box.closest('form')!);
        });
        expect(await screen.findByText('Nothing found for "zzz".')).toBeInTheDocument();
    });
});
