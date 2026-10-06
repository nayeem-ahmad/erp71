import { act, renderHook } from '@testing-library/react';
import { useSalePrinting } from './useSalePrinting';
import { printSaleChallan, printSaleInvoice, printSaleInvoices } from '@/lib/sale-print-actions';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

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
    const { formatMessage } = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({
            t: enMessages,
            locale: 'en',
            fmt: (template: string, values: Record<string, string | number>) => formatMessage(template, values, 'en'),
        }),
    };
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

const memberLayout = { version: 1, padding: 'wide', table_style: 'grid' };
const resolveLayout = jest.fn();

jest.mock('./useInvoicePrintPrefs', () => ({
    useInvoicePrintPrefs: () => ({ prefs: memberLayout, resolve: resolveLayout, save: jest.fn() }),
}));

jest.mock('@/lib/sale-print-actions', () => ({
    ...jest.requireActual('@/lib/sale-print-actions'),
    printSaleInvoice: jest.fn(),
    printSaleInvoices: jest.fn(),
    printSaleChallan: jest.fn(),
    printSaleReceipt: jest.fn(),
}));

jest.mock('@/lib/api', () => ({ api: { printSalesBatch: jest.fn(), getSale: jest.fn() } }));
jest.mock('@/lib/toast', () => ({ toast: { error: jest.fn(), info: jest.fn(), success: jest.fn() } }));

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
        resolveLayout.mockResolvedValue(memberLayout);
    });

    it('prints the invoice in the layout the member saved', async () => {
        const { result } = renderHook(() => useSalePrinting({ resolve: async () => gulshanSale }));

        await act(() => result.current.printInvoice('sale-1', 'A4'));

        expect(resolveLayout).toHaveBeenCalled();
        expect(printSaleInvoice).toHaveBeenCalledWith(
            gulshanSale,
            'A4',
            expect.objectContaining({ invoiceLayout: memberLayout }),
            true,
        );
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

    describe('printInvoices', () => {
        const dhanmondiSale = { ...gulshanSale, id: 'sale-2', store_id: 'dhanmondi', store: { name: 'Dhanmondi' } };
        const secondGulshan = { ...gulshanSale, id: 'sale-3' };

        beforeEach(() => {
            invoiceResolve.mockImplementation(async (storeId: string) => ({
                headerConfig: { layout: `${storeId}-invoice` },
                companyName: 'Acme',
            }));
            (printSaleInvoices as jest.Mock).mockReturnValue(true);
        });

        it('prints the selection as one job, each sale on its own branch letterhead', async () => {
            (api.printSalesBatch as jest.Mock).mockResolvedValue([gulshanSale, dhanmondiSale, secondGulshan]);
            const { result } = renderHook(() => useSalePrinting({ resolve: async () => null }));

            await act(() => result.current.printInvoices(['sale-1', 'sale-2', 'sale-3', 'sale-1']));

            expect(api.printSalesBatch).toHaveBeenCalledWith(['sale-1', 'sale-2', 'sale-3']);
            // One letterhead per branch, not one per sale.
            expect(invoiceResolve).toHaveBeenCalledTimes(2);
            expect(printSaleInvoices).toHaveBeenCalledTimes(1);

            const [sales, size, ctx, skip, headerFor] = (printSaleInvoices as jest.Mock).mock.calls[0];
            expect(sales).toEqual([gulshanSale, dhanmondiSale, secondGulshan]);
            expect(size).toBe('A4');
            expect(ctx.invoiceLayout).toBe(memberLayout);
            expect(skip).toBe(true);
            expect(headerFor(gulshanSale).headerConfig).toEqual({ layout: 'gulshan-invoice' });
            expect(headerFor(dhanmondiSale).headerConfig).toEqual({ layout: 'dhanmondi-invoice' });
            expect(toast.info).not.toHaveBeenCalled();
        });

        it('says how many sales it left out when some could not be loaded', async () => {
            (api.printSalesBatch as jest.Mock).mockResolvedValue([gulshanSale]);
            const { result } = renderHook(() => useSalePrinting({ resolve: async () => null }));

            await act(() => result.current.printInvoices(['sale-1', 'sale-2']));

            expect(toast.info).toHaveBeenCalledWith('1 of 2 selected sales could not be loaded and were left out.');
            expect(printSaleInvoices).toHaveBeenCalledTimes(1);
        });

        it('prints nothing and says so when none could be loaded', async () => {
            (api.printSalesBatch as jest.Mock).mockResolvedValue([]);
            const { result } = renderHook(() => useSalePrinting({ resolve: async () => null }));

            await act(() => result.current.printInvoices(['sale-1']));

            expect(printSaleInvoices).not.toHaveBeenCalled();
            expect(toast.error).toHaveBeenCalledWith('Could not load the selected sales to print.');
        });

        it('asks for pop-ups when the browser blocked the window', async () => {
            (api.printSalesBatch as jest.Mock).mockResolvedValue([gulshanSale]);
            (printSaleInvoices as jest.Mock).mockReturnValue(false);
            const { result } = renderHook(() => useSalePrinting({ resolve: async () => null }));

            await act(() => result.current.printInvoices(['sale-1']));

            expect(toast.error).toHaveBeenCalledWith('Allow pop-ups for this site to print.');
        });
    });
});
