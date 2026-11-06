import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import OpeningBalancesPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getAccounts: jest.fn(),
        importOpeningBalances: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

// The account picker is its own tested component; a plain select drives it here.
jest.mock('@/components/accounting/AccountSelect', () => ({
    __esModule: true,
    default: ({ accounts, value, onChange, ariaLabel }: any) => (
        <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
    ),
}));

// The toolbar chips sit in the row only on a wide screen.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const ACCOUNTS = [
    { id: 'cash', name: 'Cash in Hand', code: '110101', type: 'asset' },
    { id: 'capital', name: 'Owner Capital', code: '310101', type: 'equity' },
];

function fill(row: number, accountId: string, side: 'Debit' | 'Credit', amount: string) {
    fireEvent.change(screen.getByLabelText(`Account row ${row}`), { target: { value: accountId } });
    fireEvent.change(screen.getByLabelText(`${side} ${row}`), { target: { value: amount } });
}

const strip = () => screen.getByRole('region', { name: 'Opening balances summary' });
const tile = (label: string) => within(strip()).getByText(label).parentElement as HTMLElement;

describe('OpeningBalancesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getAccounts as jest.Mock).mockResolvedValue(ACCOUNTS);
        (api.importOpeningBalances as jest.Mock).mockResolvedValue({ id: 'voucher-1' });
    });

    it('sums the entry in the strip and warns while it is unbalanced', async () => {
        render(<OpeningBalancesPage />);
        await waitFor(() => expect(screen.getAllByRole('option', { name: 'Cash in Hand' }).length).toBeGreaterThan(0));

        fill(1, 'cash', 'Debit', '5000');
        expect(tile('Debit total')).toHaveTextContent('5,000');
        expect(tile('Difference')).toHaveTextContent('5,000');
        expect(tile('Difference').querySelector('.text-amber-700')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Post Opening Balances' })).toBeDisabled();

        fill(2, 'capital', 'Credit', '5000');
        expect(tile('Credit total')).toHaveTextContent('5,000');
        expect(tile('Difference').querySelector('.text-amber-700')).toBeNull();
        expect(tile('Accounts with a balance')).toHaveTextContent('2');
    });

    it('narrows the grid by account type, and still posts every row', async () => {
        render(<OpeningBalancesPage />);
        await waitFor(() => expect(screen.getAllByRole('option', { name: 'Cash in Hand' }).length).toBeGreaterThan(0));
        fill(1, 'cash', 'Debit', '5000');
        fill(2, 'capital', 'Credit', '5000');

        fireEvent.click(
            screen.getAllByRole('button', { name: 'Account type' }).find((b) => b.getAttribute('aria-haspopup') === 'dialog')!,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Equity' }));

        await waitFor(() => expect(screen.queryByLabelText('Account row 1')).not.toBeInTheDocument());
        expect(screen.getByLabelText('Account row 2')).toBeInTheDocument();
        expect(screen.getByText('1 rows hidden by the filters are still posted.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Post Opening Balances' }));

        await waitFor(() =>
            expect(api.importOpeningBalances).toHaveBeenCalledWith({
                asOfDate: expect.any(String),
                entries: [
                    { accountId: 'cash', debitAmount: 5000, creditAmount: 0 },
                    { accountId: 'capital', debitAmount: 0, creditAmount: 5000 },
                ],
            }),
        );
        expect(await screen.findByText('Opening Balances Imported')).toBeInTheDocument();
    });
});
