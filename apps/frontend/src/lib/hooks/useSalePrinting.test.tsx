import { act, renderHook } from '@testing-library/react';
import { useSalePrinting } from './useSalePrinting';
import { printSaleChallan, printSaleInvoice } from '@/lib/sale-print-actions';

const invoiceResolve = jest.fn();
const challanResolve = jest.fn();

jest.mock('@/lib/print/use-print-header', () => ({
    usePrintHeader: (docType: string) => ({
        headerConfig: { layout: 'session' },
        companyName: 'Acme',
        resolve: docType === 'DELIVERY_CHALLAN' ? challanResolve : invoiceResolve,
    }),
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = jest.requireActual('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages, locale: 'en' }) };
});

jest.mock('./useSalePrintPrefs', () => ({
    useSalePrintPrefs: () => ({
        paperSize: 'A4',
        setPaperSize: jest.fn(),
        skipPreview: true,
        setSkipPreview: jest.fn(),
        density: 'normal',
        setDensity: jest.fn(),
    }),
}));

jest.mock('@/lib/sale-print-actions', () => ({
    printSaleInvoice: jest.fn(),
    printSaleChallan: jest.fn(),
    printSaleReceipt: jest.fn(),
}));

const gulshanSale = {
    id: 'sale-1',
    serial_number: 'SL-1',
    created_at: '2026-10-01T00:00:00.000Z',
    total_amount: '100',
    amount_paid: '100',
    store_id: 'gulshan',
    store: { name: 'Gulshan', address: null },
    items: [],
};

describe('useSalePrinting', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        invoiceResolve.mockResolvedValue({ headerConfig: { layout: 'gulshan-invoice' }, companyName: 'Acme' });
        challanResolve.mockResolvedValue({ headerConfig: { layout: 'gulshan-challan' }, companyName: 'Acme' });
    });

    it('prints a list row on the letterhead of the sale’s own store', async () => {
        const { result } = renderHook(() => useSalePrinting({ resolve: async () => gulshanSale }));

        await act(() => result.current.printInvoice('sale-1', 'A4'));

        expect(invoiceResolve).toHaveBeenCalledWith('gulshan');
        expect(printSaleInvoice).toHaveBeenCalledWith(
            gulshanSale,
            'A4',
            expect.objectContaining({
                invoiceHeader: expect.objectContaining({ headerConfig: { layout: 'gulshan-invoice' } }),
            }),
            true,
        );
    });

    it('resolves the challan letterhead from the sale’s store too', async () => {
        const { result } = renderHook(() => useSalePrinting({ resolve: async () => gulshanSale }));

        await act(() => result.current.printChallan('sale-1', 'A4'));

        expect(challanResolve).toHaveBeenCalledWith('gulshan');
        expect(printSaleChallan).toHaveBeenCalledWith(
            gulshanSale,
            'A4',
            expect.objectContaining({
                challanHeader: expect.objectContaining({ headerConfig: { layout: 'gulshan-challan' } }),
            }),
            true,
        );
    });
});
