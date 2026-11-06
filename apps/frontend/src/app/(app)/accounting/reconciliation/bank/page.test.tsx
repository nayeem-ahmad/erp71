import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { formatBDT } from '@/lib/format';
import BankReconciliationPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getAccounts: jest.fn(),
        createBankReconciliation: jest.fn(),
        importBankStatementEntries: jest.fn(),
        autoMatchBankEntries: jest.fn(),
        getBankReconciliationReport: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/accounting/reconciliation/bank',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

// The global matchMedia mock reports a phone, which puts the chips in the
// filter sheet and hides `hideOnMobile` columns.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

// The searchable account picker has tests of its own; a native select keeps
// these about the reconciliation steps.
jest.mock('@/components/accounting/AccountSelect', () => ({
    __esModule: true,
    default: ({ accounts, value, onChange, ariaLabel, placeholder }: any) => (
        <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{placeholder}</option>
            {accounts.map((account: { id: string; name: string }) => (
                <option key={account.id} value={account.id}>{account.name}</option>
            ))}
        </select>
    ),
}));

const money = (value: number) => formatBDT(value, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 });

const ENTRIES = {
    salary: { id: 'e1', entry_date: '2026-06-01', description: 'Salary payment', amount: 50000, entry_type: 'DEBIT' },
    deposit: { id: 'e2', entry_date: '2026-06-02', description: 'Customer deposit', amount: 30000, entry_type: 'CREDIT' },
    charge: { id: 'e3', entry_date: '2026-06-03', description: 'Bank charge', amount: 1500, entry_type: 'DEBIT' },
};

const REPORT_BEFORE = {
    reconciliation: { id: 'rec-1', account_id: 'bank-1', statement_date: '2026-06-30', statement_closing_balance: 98500, status: 'OPEN' },
    summary: { book_balance: 100000, statement_balance: 98500, difference: 1500, matched_entries: 1, unmatched_entries: 2 },
    matched_entries: [ENTRIES.salary],
    unmatched_entries: [ENTRIES.deposit, ENTRIES.charge],
};

const REPORT_AFTER = {
    ...REPORT_BEFORE,
    summary: { book_balance: 98500, statement_balance: 98500, difference: 0, matched_entries: 3, unmatched_entries: 0 },
    matched_entries: [ENTRIES.salary, ENTRIES.deposit, ENTRIES.charge],
    unmatched_entries: [],
};

const strip = () => screen.getByRole('region', { name: 'Reconciliation figures' });
const tile = (label: string) => within(strip()).getByText(label).parentElement as HTMLElement;
const figure = (label: string) => tile(label).querySelector('p:last-child') as HTMLElement;
const openChip = (name: string) =>
    fireEvent.click(
        screen.getAllByRole('button', { name }).find((b) => b.getAttribute('aria-haspopup') === 'dialog')!,
    );

async function reachMatchStep() {
    render(<BankReconciliationPage />);
    const account = screen.getByRole('combobox', { name: 'Bank Account' });
    await within(account).findByRole('option', { name: 'City Bank' });
    fireEvent.change(account, { target: { value: 'bank-1' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '98500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: import statement' }));

    const statement = await screen.findByRole('textbox', { name: '2. Paste bank statement entries' });
    fireEvent.change(statement, {
        target: { value: '2026-06-01, Salary payment, 50000, DEBIT\n2026-06-02, Customer deposit, -30000, credit\n\n2026-06-03, Bank charge, 1500, ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import and continue' }));
    await screen.findByText('Customer deposit');
}

describe('BankReconciliationPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getAccounts as jest.Mock).mockResolvedValue([
            { id: 'bank-1', name: 'City Bank', code: '1020', category: 'BANK' },
            { id: 'cash-1', name: 'Cash in Hand', code: '1010', category: 'CASH' },
        ]);
        (api.createBankReconciliation as jest.Mock).mockResolvedValue({ id: 'rec-1' });
        (api.importBankStatementEntries as jest.Mock).mockResolvedValue({ imported: 3 });
        (api.getBankReconciliationReport as jest.Mock).mockResolvedValue(REPORT_BEFORE);
        (api.autoMatchBankEntries as jest.Mock).mockResolvedValue({ matched: 2 });
    });

    it('walks set-up, import and match, sending what was typed', async () => {
        render(<BankReconciliationPage />);
        expect(screen.getByText('1. Set up reconciliation')).toBeInTheDocument();
        expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Set up');

        const account = screen.getByRole('combobox', { name: 'Bank Account' });
        await within(account).findByRole('option', { name: 'City Bank' });
        // Only bank accounts can be reconciled against a bank statement.
        expect(within(account).queryByRole('option', { name: 'Cash in Hand' })).not.toBeInTheDocument();

        const next = screen.getByRole('button', { name: 'Next: import statement' });
        expect(next).toBeDisabled();
        fireEvent.change(account, { target: { value: 'bank-1' } });
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '98500' } });
        expect(next).toBeEnabled();
        fireEvent.click(next);

        await waitFor(() => expect(api.createBankReconciliation).toHaveBeenCalledWith(
            expect.objectContaining({ accountId: 'bank-1', statementClosingBalance: 98500 }),
        ));
        const statement = await screen.findByRole('textbox', { name: '2. Paste bank statement entries' });
        expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Import');
        expect(screen.getByRole('button', { name: 'Import and continue' })).toBeDisabled();

        fireEvent.change(statement, {
            target: { value: '2026-06-01, Salary payment, 50000, DEBIT\n2026-06-02, Customer deposit, -30000, credit\n\n2026-06-03, , 1500, ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Import and continue' }));

        await waitFor(() => expect(api.importBankStatementEntries).toHaveBeenCalledWith({
            reconciliationId: 'rec-1',
            entries: [
                { entryDate: '2026-06-01', description: 'Salary payment', amount: 50000, entryType: 'DEBIT' },
                { entryDate: '2026-06-02', description: 'Customer deposit', amount: 30000, entryType: 'CREDIT' },
                { entryDate: '2026-06-03', description: undefined, amount: 1500, entryType: 'DEBIT' },
            ],
        }));
        expect(api.getBankReconciliationReport).toHaveBeenCalledWith('rec-1');
        await screen.findByText('Customer deposit');
        expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Match');
    });

    it('goes back from import to set-up', async () => {
        render(<BankReconciliationPage />);
        const account = screen.getByRole('combobox', { name: 'Bank Account' });
        await within(account).findByRole('option', { name: 'City Bank' });
        fireEvent.change(account, { target: { value: 'bank-1' } });
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: 'Next: import statement' }));
        await screen.findByRole('textbox', { name: '2. Paste bank statement entries' });

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('1. Set up reconciliation')).toBeInTheDocument();
    });

    it('keeps the set-up step and shows the error when the reconciliation cannot be created', async () => {
        (api.createBankReconciliation as jest.Mock).mockRejectedValue(new Error('Statement date is in a locked period'));
        render(<BankReconciliationPage />);
        const account = screen.getByRole('combobox', { name: 'Bank Account' });
        await within(account).findByRole('option', { name: 'City Bank' });
        fireEvent.change(account, { target: { value: 'bank-1' } });
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: 'Next: import statement' }));

        expect(await screen.findByText('Statement date is in a locked period')).toBeInTheDocument();
        expect(screen.getByText('1. Set up reconciliation')).toBeInTheDocument();
        expect(api.importBankStatementEntries).not.toHaveBeenCalled();
    });

    it('puts the balances in the strip, the difference in red while it is not zero', async () => {
        await reachMatchStep();

        expect(figure('Book balance')).toHaveTextContent(money(100000));
        expect(figure('Statement balance')).toHaveTextContent(money(98500));
        expect(figure('Difference')).toHaveTextContent(money(1500));
        expect(figure('Difference')).toHaveClass('text-red-600');
        expect(figure('Matched')).toHaveTextContent('1');
        expect(figure('Matched')).toHaveTextContent(money(50000));
        expect(figure('Unmatched')).toHaveTextContent('2');
        expect(figure('Unmatched')).toHaveTextContent(money(31500));
        expect(figure('Unmatched')).toHaveClass('text-amber-700');
    });

    it('narrows the entries by the status and type chips, and the strip counts what is left', async () => {
        await reachMatchStep();
        expect(screen.getByText('Salary payment')).toBeInTheDocument();

        openChip('Status');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Unmatched' }));
        await waitFor(() => expect(screen.queryByText('Salary payment')).not.toBeInTheDocument());
        expect(screen.getByText('Customer deposit')).toBeInTheDocument();
        expect(screen.getByText('Bank charge')).toBeInTheDocument();
        expect(figure('Matched')).toHaveTextContent('0');
        expect(figure('Unmatched')).toHaveTextContent('2');
        // The balances describe the whole statement, not the rows on screen.
        expect(figure('Difference')).toHaveTextContent(money(1500));

        openChip('Type');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Credit' }));
        await waitFor(() => expect(screen.queryByText('Bank charge')).not.toBeInTheDocument());
        expect(screen.getByText('Customer deposit')).toBeInTheDocument();
        expect(figure('Unmatched')).toHaveTextContent('1');
        expect(figure('Unmatched')).toHaveTextContent(money(30000));
    });

    it('auto-matches, reloads the report and hides the button once done', async () => {
        await reachMatchStep();
        (api.getBankReconciliationReport as jest.Mock).mockResolvedValue(REPORT_AFTER);

        fireEvent.click(screen.getByRole('button', { name: 'Auto-match by date and amount' }));

        await waitFor(() => expect(api.autoMatchBankEntries).toHaveBeenCalledWith('rec-1'));
        await waitFor(() => expect(figure('Difference')).toHaveTextContent(money(0)));
        expect(api.getBankReconciliationReport).toHaveBeenCalledTimes(2);
        expect(figure('Difference')).not.toHaveClass('text-red-600');
        expect(figure('Unmatched')).toHaveTextContent('0');
        expect(figure('Matched')).toHaveTextContent('3');
        expect(screen.queryByRole('button', { name: 'Auto-match by date and amount' })).not.toBeInTheDocument();
    });

    it('shows the error and keeps the button when auto-match fails', async () => {
        await reachMatchStep();
        (api.autoMatchBankEntries as jest.Mock).mockRejectedValue(new Error('No book entries in range'));

        fireEvent.click(screen.getByRole('button', { name: 'Auto-match by date and amount' }));

        expect(await screen.findByText('No book entries in range')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Auto-match by date and amount' })).toBeInTheDocument();
        expect(api.getBankReconciliationReport).toHaveBeenCalledTimes(1);
    });
});
