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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CustomerLedgerPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: () => null }),
}));

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
});
