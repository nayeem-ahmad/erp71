'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CustomerDuesSummaryPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/api', () => ({
    api: {
        getCustomerDuesSummary: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/customers/reports/dues-summary',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// The rows the page hands the table, in order — what it chose to show.
jest.mock('@/components/data-table', () => ({
    DataTable: ({ data, title, isLoading }: { data: { id: string; name: string }[]; title: string; isLoading: boolean }) => (
        <div>
            <div data-testid="data-table-title">{title}</div>
            {isLoading && <div data-testid="loading-indicator">Loading</div>}
            <ul data-testid="rows">
                {data.map((row) => <li key={row.id}>{row.name}</li>)}
            </ul>
        </div>
    ),
}));

const KARIM = { id: 'emp-1', name: 'Karim' };
const SALMA = { id: 'emp-2', name: 'Salma' };
const DHAKA = { id: 'store-1', name: 'Dhaka Branch' };

const row = (id: string, name: string, due: number, rep: { id: string; name: string } | null) => ({
    id,
    name,
    customer_code: `CUST-${id}`,
    phone: null,
    due_balance: due,
    store: DHAKA,
    sales_rep: rep,
});

const ROWS = [
    row('c1', 'Rahim Traders', 5000, KARIM),
    row('c2', 'Bhai Bhai Store', 2500, SALMA),
    row('c3', 'Square Shop', 0, KARIM),
    row('c4', 'Paid Ahead Ltd', -300, null),
];

function shownRows() {
    return within(screen.getByTestId('rows')).queryAllByRole('listitem').map((li) => li.textContent);
}

function stat(label: string) {
    return screen.getByText(label).nextElementSibling?.textContent;
}

describe('CustomerDuesSummaryPage', () => {
    let api: { getCustomerDuesSummary: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api = require('@/lib/api').api;
        api.getCustomerDuesSummary.mockResolvedValue({ me: null, rows: ROWS });
    });

    it('loads the customers of the selected branch', async () => {
        render(<CustomerDuesSummaryPage />);

        expect(screen.getByRole('heading', { name: 'Customer Dues Summary' })).toBeInTheDocument();
        await waitFor(() => expect(api.getCustomerDuesSummary).toHaveBeenCalledWith({ storeId: 'store-1' }));
        await waitFor(() => expect(shownRows()).toEqual(['Rahim Traders', 'Bhai Bhai Store', 'Square Shop', 'Paid Ahead Ltd']));
    });

    it('reloads when the branch changes', async () => {
        render(<CustomerDuesSummaryPage />);
        await waitFor(() => expect(api.getCustomerDuesSummary).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'all' } });

        await waitFor(() => expect(api.getCustomerDuesSummary).toHaveBeenLastCalledWith({ storeId: 'all' }));
    });

    it('totals what is owed and what is held in advance separately', async () => {
        render(<CustomerDuesSummaryPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        expect(stat('Customers')).toBe('4');
        expect(stat('Customers with due')).toBe('2');
        expect(stat('Total due')).toContain('7,500');
        expect(stat('Paid in advance')).toContain('300');
    });

    it("opens on the viewer's own customers when they are someone's sales rep", async () => {
        api.getCustomerDuesSummary.mockResolvedValue({ me: KARIM, rows: ROWS });
        render(<CustomerDuesSummaryPage />);

        await waitFor(() => expect(shownRows()).toEqual(['Rahim Traders', 'Square Shop']));
        expect(screen.getByLabelText('Sales rep')).toHaveValue('me');
        expect(stat('Customers')).toBe('2');
        expect(stat('Total due')).toContain('5,000');

        fireEvent.change(screen.getByLabelText('Sales rep'), { target: { value: '' } });
        expect(shownRows()).toHaveLength(4);
    });

    it('stays on every customer for a viewer who is nobody\'s sales rep', async () => {
        api.getCustomerDuesSummary.mockResolvedValue({ me: { id: 'emp-9', name: 'Owner' }, rows: ROWS });
        render(<CustomerDuesSummaryPage />);

        await waitFor(() => expect(shownRows()).toHaveLength(4));
        expect(screen.getByLabelText('Sales rep')).toHaveValue('');
        // Still offered: they may be given customers later.
        expect(screen.getByRole('option', { name: 'My customers' })).toBeInTheDocument();
    });

    it('offers no "My customers" to a login linked to no employee', async () => {
        render(<CustomerDuesSummaryPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        expect(screen.queryByRole('option', { name: 'My customers' })).not.toBeInTheDocument();
    });

    it('filters to one sales rep, or to customers with none', async () => {
        render(<CustomerDuesSummaryPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        fireEvent.change(screen.getByLabelText('Sales rep'), { target: { value: SALMA.id } });
        expect(shownRows()).toEqual(['Bhai Bhai Store']);

        fireEvent.change(screen.getByLabelText('Sales rep'), { target: { value: 'none' } });
        expect(shownRows()).toEqual(['Paid Ahead Ltd']);
    });

    it('lists the sales reps of the loaded customers, by name', async () => {
        render(<CustomerDuesSummaryPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        const options = within(screen.getByLabelText('Sales rep')).getAllByRole('option').map((o) => o.textContent);
        expect(options).toEqual(['All sales reps', 'Karim', 'Salma', 'No sales rep']);
    });

    it('can hide the customers who owe nothing', async () => {
        render(<CustomerDuesSummaryPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        fireEvent.click(screen.getByLabelText('Only customers who owe'));

        expect(shownRows()).toEqual(['Rahim Traders', 'Bhai Bhai Store']);
    });

    it('survives a failed load', async () => {
        api.getCustomerDuesSummary.mockRejectedValue(new Error('boom'));
        render(<CustomerDuesSummaryPage />);

        await waitFor(() => expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument());
        expect(shownRows()).toEqual([]);
    });
});
