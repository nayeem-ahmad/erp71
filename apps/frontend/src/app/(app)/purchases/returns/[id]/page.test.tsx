'use client';

jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());
jest.mock('@/lib/print', () => require('@/test-utils/print-paper').printModuleSpy());
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockBrowserPaper, printedPaper } from '@/test-utils/print-paper';
import PurchaseReturnDetailPage from './page';

const pushMock = jest.fn();
let searchValue = '';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'pret-1' }),
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => ({ get: (key: string) => (key === 'edit' ? searchValue : null) }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getPurchaseReturn: jest.fn(),
        updatePurchaseReturn: jest.fn(),
        deletePurchaseReturn: jest.fn(),
        getPaymentLayout: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

const BKASH = {
    id: 'pm-bkash',
    name: 'bKash',
    type: 'Mobile Wallet',
    account_id: null,
    is_active: true,
    sort_order: 1,
    show_on_entry: true,
    all_branches: true,
    store_ids: [],
};

describe('PurchaseReturnDetailPage — Epic 21.4', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pushMock.mockReset();
        searchValue = '';
        window.alert = jest.fn();
        window.confirm = jest.fn(() => true);

        const { api } = require('@/lib/api');
        api.getPurchaseReturn.mockResolvedValue({
            id: 'pret-1',
            return_number: 'PRET-00001',
            created_at: '2026-03-20T12:00:00.000Z',
            total_amount: 24,
            status: 'RECORDED',
            reference_number: 'REF-1',
            notes: 'Initial note',
            supplier: { name: 'Fresh Farms' },
            purchase: {
                purchase_number: 'PUR-00001',
                items: [
                    {
                        id: 'item-1',
                        quantity: 5,
                        product: { name: 'Coffee Beans' },
                        returnItems: [{ return_id: 'pret-1', quantity: 2 }, { return_id: 'pret-other', quantity: 1 }],
                    },
                ],
            },
            items: [
                {
                    id: 'line-1',
                    purchase_item_id: 'item-1',
                    product_id: 'prod-1',
                    quantity: 2,
                    unit_cost: 12,
                    line_total: 24,
                    product: { name: 'Coffee Beans' },
                },
            ],
        });
        api.updatePurchaseReturn.mockResolvedValue({ id: 'pret-1' });
        api.deletePurchaseReturn.mockResolvedValue({ deleted: true });
        api.getPaymentLayout.mockResolvedValue({ customised: false, visible: [BKASH], available: [BKASH] });
        api.getPaymentMethods.mockResolvedValue([BKASH]);
    });

    /** The return as saved with its money received: ৳10 from the supplier on bKash, the other ৳14 against the payable. */
    const withRecordedPayments = async () => {
        const { api } = require('@/lib/api');
        const saved = await api.getPurchaseReturn();
        api.getPurchaseReturn.mockResolvedValue({
            ...saved,
            store_id: 'store-1',
            supplier_id: 'sup-1',
            tenders_recorded: true,
            payments: [
                {
                    id: 'rp-1',
                    payment_method: 'Mobile Wallet',
                    payment_method_name: 'bKash',
                    payment_method_id: 'pm-bkash',
                    account_id: 'acc-bkash',
                    amount: '10.00',
                    reference_no: 'TX-5',
                },
            ],
        });
    };

    it('renders purchase return detail data', async () => {
        render(<PurchaseReturnDetailPage />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'PRET-00001' })).toBeInTheDocument();
            expect(screen.getByText('PUR-00001')).toBeInTheDocument();
            expect(screen.getByText('Fresh Farms')).toBeInTheDocument();
            expect(screen.getByText('Initial note')).toBeInTheDocument();
        });
    });

    it('saves constrained edits in edit mode', async () => {
        searchValue = 'true';
        const { api } = require('@/lib/api');
        render(<PurchaseReturnDetailPage />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('REF-1')).toBeInTheDocument();
            expect(screen.getByDisplayValue('2')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '3' } });
        fireEvent.change(screen.getByDisplayValue('REF-1'), { target: { value: 'REF-2' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updatePurchaseReturn).toHaveBeenCalledWith(
                'pret-1',
                expect.objectContaining({
                    referenceNumber: 'REF-2',
                    items: [{ purchaseItemId: 'item-1', quantity: 3 }],
                }),
            );
        });
        expect(pushMock).toHaveBeenCalledWith('/purchases/returns/pret-1');
    });

    it('return detail lists recorded payments; edit sends payments', async () => {
        const { api } = require('@/lib/api');
        await withRecordedPayments();

        // View mode: what was received, read-only.
        const { unmount } = render(<PurchaseReturnDetailPage />);
        expect(await screen.findByText('bKash')).toBeInTheDocument();
        expect(screen.getByText('TX-5')).toBeInTheDocument();
        expect(screen.queryByLabelText(/bKash/i, { selector: 'input' })).not.toBeInTheDocument();
        unmount();

        // Edit mode: the same tenders, editable, and sent back on save.
        searchValue = 'true';
        render(<PurchaseReturnDetailPage />);
        const amount = (await screen.findByRole('spinbutton', { name: /bKash/i })) as HTMLInputElement;
        await waitFor(() => expect(amount.value).toBe('10'));
        fireEvent.change(screen.getByDisplayValue('REF-1'), { target: { value: 'REF-2' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updatePurchaseReturn).toHaveBeenCalledTimes(1));
        // Exactly the DTO's fields, the transaction id travelling with the tender.
        expect(api.updatePurchaseReturn.mock.calls[0][1].payments).toEqual([
            { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 10, referenceNo: 'TX-5' },
        ]);
    });

    it('leaves the money of a return saved before tenders alone unless the user sets some', async () => {
        searchValue = 'true';
        const { api } = require('@/lib/api');
        render(<PurchaseReturnDetailPage />);
        await waitFor(() => expect(screen.getByDisplayValue('REF-1')).toBeInTheDocument());
        fireEvent.change(screen.getByDisplayValue('REF-1'), { target: { value: 'REF-2' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updatePurchaseReturn).toHaveBeenCalledTimes(1));
        expect(api.updatePurchaseReturn.mock.calls[0][1]).not.toHaveProperty('payments');
    });

    it('deletes the purchase return after confirmation', async () => {
        const { api } = require('@/lib/api');
        render(<PurchaseReturnDetailPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /delete/i }));

        await waitFor(() => {
            expect(api.deletePurchaseReturn).toHaveBeenCalledWith('pret-1');
        });
        expect(pushMock).toHaveBeenCalledWith('/purchases/returns');
    });

    describe('printing on the browser’s paper', () => {
        let openSpy: jest.SpyInstance;
        beforeEach(() => {
            openSpy = jest.spyOn(window, 'open').mockReturnValue(null);
        });
        afterEach(() => openSpy.mockRestore());

        it.each([
            ['A5', 'A5'],
            ['Letter', 'Letter'],
            ['Thermal80', 'A4'],
        ] as const)('prints a purchase return chosen as %s on %s, with that paper’s letterhead', async (chosen, printed) => {
            mockBrowserPaper(chosen);
            render(<PurchaseReturnDetailPage />);
            fireEvent.click(await screen.findByRole('button', { name: /print preview/i }));
            await waitFor(() => expect(printedPaper()).toEqual({ page: printed, letterhead: printed }));
        });
    });
});