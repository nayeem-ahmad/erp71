jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');

    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, unknown> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
}, { virtual: true });

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CustomerLedgerPage from './page';
import { api } from '@/lib/api';
import { mockBranchScope, resetToHeaderSpy } from '@/test-utils/branch-scope';

let mockCustomerParam: string | null = null;
jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: (key: string) => (key === 'customerId' ? mockCustomerParam : null) }),
}));

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock('@/lib/api', () => ({
    api: {
        getCustomers: jest.fn(),
        getCustomerGlLedger: jest.fn(),
    },
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ title }: { title: string }) => <div data-testid="ledger-table">{title}</div>,
}));

const ALICE = { id: 'cust-alice', name: 'Alice Corp', phone: '01700000001', due_balance: 100 };
const BOB = { id: 'cust-bob', name: 'Bob Traders', phone: '01700000002', due_balance: 50 };
const KARIM = { id: 'cust-karim', name: 'Karim Electronics', phone: '01700000003', due_balance: 0 };

const EMPTY_LEDGER = {
    due_balance: 0,
    opening_balance: 0,
    closing_balance: 0,
    transactions: [],
};

describe('CustomerLedgerPage customer picker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCustomerParam = null;
        mockBranchScope();
        (api.getCustomers as jest.Mock).mockResolvedValue([ALICE, BOB, KARIM]);
        (api.getCustomerGlLedger as jest.Mock).mockResolvedValue(EMPTY_LEDGER);
    });

    it('narrows the customer list as you type and loads the picked ledger', async () => {
        render(<CustomerLedgerPage />);

        const search = await screen.findByLabelText('Select customer…');
        await waitFor(() => expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-alice', expect.any(Object)));

        fireEvent.focus(search);
        fireEvent.change(search, { target: { value: 'Bob' } });

        expect(await screen.findByText('Bob Traders')).toBeInTheDocument();
        expect(screen.queryByText(/Karim Electronics/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Bob Traders'));

        await waitFor(() => {
            expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-bob', expect.any(Object));
        });
    });

    describe('branch', () => {
        it("lists the header branch's customers", async () => {
            render(<CustomerLedgerPage />);

            await waitFor(() => expect(api.getCustomers).toHaveBeenCalledWith({ storeId: 'store-1' }));
            expect(screen.getByRole('combobox', { name: 'Branch' })).toHaveValue('store-1');
        });

        it('asks nothing until the branch is known', async () => {
            mockBranchScope({ ready: false });
            render(<CustomerLedgerPage />);
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

            expect(api.getCustomers).not.toHaveBeenCalled();
            expect(api.getCustomerGlLedger).not.toHaveBeenCalled();
        });

        it("drops the old branch's customer and shows the new branch's ledger", async () => {
            render(<CustomerLedgerPage />);
            await waitFor(() => expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-alice', expect.any(Object)));

            (api.getCustomers as jest.Mock).mockResolvedValue([KARIM]);
            (api.getCustomerGlLedger as jest.Mock).mockClear();
            fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'store-2' } });

            await waitFor(() => expect(api.getCustomers).toHaveBeenLastCalledWith({ storeId: 'store-2' }));
            await waitFor(() => expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-karim', expect.any(Object)));
            expect(api.getCustomerGlLedger).not.toHaveBeenCalledWith('cust-alice', expect.any(Object));
            expect(screen.getByLabelText('Select customer…')).toHaveAttribute('placeholder', 'Karim Electronics');
        });

        it('goes back to the header branch when the server refuses the one picked', async () => {
            render(<CustomerLedgerPage />);
            await waitFor(() => expect(api.getCustomers).toHaveBeenCalledWith({ storeId: 'store-1' }));

            (api.getCustomers as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
            fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'store-2' } });

            await waitFor(() => expect(resetToHeaderSpy).toHaveBeenCalled());
            await waitFor(() => expect(screen.getByRole('combobox', { name: 'Branch' })).toHaveValue('store-1'));
        });

        it('keeps a linked customer from another branch, named from its ledger', async () => {
            mockCustomerParam = 'cust-zed';
            (api.getCustomerGlLedger as jest.Mock).mockResolvedValue({
                ...EMPTY_LEDGER,
                customer: { id: 'cust-zed', name: 'Zed Stores', phone: '01700000009' },
            });
            render(<CustomerLedgerPage />);

            await waitFor(() => expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-zed', expect.any(Object)));
            await waitFor(() => expect(screen.getByLabelText('Select customer…')).toHaveAttribute('placeholder', 'Zed Stores'));
            expect(api.getCustomerGlLedger).not.toHaveBeenCalledWith('cust-alice', expect.any(Object));
        });
    });
});
