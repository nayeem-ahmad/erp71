import { fireEvent, render, screen, within } from '@testing-library/react';
import AccountSelect, { accountLabel, sortAccountsByCode } from './AccountSelect';

jest.mock('lucide-react', () => ({
    Check: () => <span data-testid="icon-check" />,
    ChevronDown: () => <span data-testid="icon-chevron-down" />,
    Search: () => <span data-testid="icon-search" />,
}));

const ACCOUNTS = [
    { id: 'a-bank', name: 'City Bank', code: '110102' },
    { id: 'a-cash', name: 'Cash in Hand', code: '110101' },
    { id: 'a-new', name: 'Zebra Account', code: null },
    { id: 'a-rent', name: 'Rent', code: '510101' },
];

function openList(onChange = jest.fn()) {
    render(
        <AccountSelect accounts={ACCOUNTS} value="" onChange={onChange} ariaLabel="Account" />,
    );
    fireEvent.click(screen.getByLabelText('Account'));
    return { onChange, listbox: screen.getByRole('listbox', { name: 'Account' }) };
}

function rowNames(listbox: HTMLElement) {
    return within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent?.replace(/\s+/g, ' ').trim());
}

describe('sortAccountsByCode', () => {
    it('orders by code, sinking uncoded accounts to the end', () => {
        expect(sortAccountsByCode(ACCOUNTS).map((account) => account.id)).toEqual([
            'a-cash',
            'a-bank',
            'a-rent',
            'a-new',
        ]);
    });

    it('does not mutate the input', () => {
        const input = [...ACCOUNTS];
        sortAccountsByCode(input);
        expect(input.map((account) => account.id)).toEqual(ACCOUNTS.map((account) => account.id));
    });
});

describe('accountLabel', () => {
    it('leads with the code when there is one', () => {
        expect(accountLabel({ id: 'x', name: 'Rent', code: '510101' })).toBe('510101 — Rent');
        expect(accountLabel({ id: 'x', name: 'Rent' })).toBe('Rent');
    });
});

describe('AccountSelect', () => {
    it('lists accounts in code order', () => {
        const { listbox } = openList();

        expect(rowNames(listbox)).toEqual([
            '110101Cash in Hand',
            '110102City Bank',
            '510101Rent',
            '—Zebra Account',
        ]);
    });

    it('filters by name and by code', () => {
        const { listbox } = openList();
        const search = screen.getByLabelText('Search by code or name…');

        fireEvent.change(search, { target: { value: 'rent' } });
        expect(rowNames(listbox)).toEqual(['510101Rent']);

        fireEvent.change(search, { target: { value: '1101' } });
        expect(rowNames(listbox)).toEqual(['110101Cash in Hand', '110102City Bank']);
    });

    it('reports when nothing matches', () => {
        openList();

        fireEvent.change(screen.getByLabelText('Search by code or name…'), {
            target: { value: 'nothing' },
        });

        expect(screen.getByText('No matching account')).toBeInTheDocument();
        expect(screen.queryAllByRole('option')).toHaveLength(0);
    });

    it('commits the clicked account and closes', () => {
        const { onChange, listbox } = openList();

        fireEvent.click(within(listbox).getByText('City Bank'));

        expect(onChange).toHaveBeenCalledWith('a-bank');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('commits the highlighted account on Enter after arrowing down', () => {
        const { onChange } = openList();
        const search = screen.getByLabelText('Search by code or name…');

        fireEvent.keyDown(search, { key: 'ArrowDown' });
        fireEvent.keyDown(search, { key: 'Enter' });

        // Highlight starts on the first row, so one ArrowDown lands on City Bank.
        expect(onChange).toHaveBeenCalledWith('a-bank');
    });

    it('closes on Escape without choosing anything', () => {
        const { onChange } = openList();

        fireEvent.keyDown(screen.getByLabelText('Search by code or name…'), { key: 'Escape' });

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('shows the selected account as code and name on the trigger', () => {
        render(
            <AccountSelect
                accounts={ACCOUNTS}
                value="a-rent"
                onChange={jest.fn()}
                ariaLabel="Account"
            />,
        );

        expect(screen.getByLabelText('Account')).toHaveTextContent('510101 — Rent');
    });

    it('offers an explicit clear entry when asked', () => {
        const onChange = jest.fn();
        render(
            <AccountSelect
                accounts={ACCOUNTS}
                value="a-rent"
                onChange={onChange}
                ariaLabel="Account"
                allowClear
                clearLabel="All Cash Accounts"
            />,
        );

        fireEvent.click(screen.getByLabelText('Account'));
        fireEvent.click(screen.getByText('All Cash Accounts'));

        expect(onChange).toHaveBeenCalledWith('');
    });
});
