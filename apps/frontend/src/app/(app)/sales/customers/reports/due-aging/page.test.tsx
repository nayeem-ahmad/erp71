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
import DueAgingReportPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/api', () => ({
    api: {
        getDueAgingReport: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/customers/reports/due-aging',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// The rows the page hands the table, in order, and its toolbar filters drawn
// as plain selects — "All" is the empty value, as in the real FilterBar.
jest.mock('@/components/data-table', () => ({
    DataTable: ({ data, title, isLoading, filters = [], columns }: any) => (
        <div>
            <div data-testid="data-table-title">{title}</div>
            {isLoading && <div data-testid="loading-indicator">Loading</div>}
            {filters.map((filter: any) => (
                <select
                    key={filter.id}
                    aria-label={filter.label}
                    value={filter.value ?? ''}
                    onChange={(e) => filter.onChange(e.target.value || null)}
                >
                    <option value="">All</option>
                    {filter.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            ))}
            <div data-testid="columns">{columns.map((c: any) => c.id ?? c.accessorKey).join(',')}</div>
            <ul data-testid="rows">
                {data.map((row: any) => <li key={row.customer.id}>{row.customer.name}</li>)}
            </ul>
        </div>
    ),
}));

const KARIM = { id: 'emp-1', name: 'Karim' };
const SALMA = { id: 'emp-2', name: 'Salma' };
const DHAKA = { id: 'store-1', name: 'Dhaka Branch' };
const WHOLESALE = { id: 'grp-1', name: 'Wholesale' };
const MIRPUR = { id: 'ter-1', name: 'Mirpur' };

type Buckets = [number, number, number, number];

const row = (
    id: string,
    name: string,
    [b0, b31, b61, b90]: Buckets,
    extra: { rep?: typeof KARIM | null; group?: typeof WHOLESALE | null; territory?: typeof MIRPUR | null } = {},
) => ({
    customer: { id, name, phone: null, customer_code: `CUST-${id}` },
    store: DHAKA,
    sales_rep: extra.rep ?? null,
    customer_group: extra.group ?? null,
    territory: extra.territory ?? null,
    last_payment: null,
    bucket_0_30: b0,
    bucket_31_60: b31,
    bucket_61_90: b61,
    bucket_90_plus: b90,
    total: b0 + b31 + b61 + b90,
});

const ROWS = [
    row('c1', 'Rahim Traders', [1000, 0, 0, 4000], { rep: KARIM, group: WHOLESALE, territory: MIRPUR }),
    row('c2', 'Bhai Bhai Store', [500, 2000, 0, 0], { rep: SALMA, group: WHOLESALE }),
    row('c3', 'Fresh Mart', [0, 0, 1500, 0], { rep: KARIM }),
    row('c4', 'Corner Shop', [300, 0, 0, 0]),
];

function shownRows() {
    return within(screen.getByTestId('rows')).queryAllByRole('listitem').map((li) => li.textContent);
}

function stat(label: string) {
    return screen.getByText(label, { selector: 'p' }).nextElementSibling?.textContent;
}

describe('DueAgingReportPage', () => {
    let api: { getDueAgingReport: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api = require('@/lib/api').api;
        api.getDueAgingReport.mockResolvedValue({ me: null, rows: ROWS });
    });

    it('loads the dues of the selected branch, as of today', async () => {
        render(<DueAgingReportPage />);

        expect(screen.getByRole('heading', { name: 'Due Aging Report' })).toBeInTheDocument();
        await waitFor(() => expect(api.getDueAgingReport).toHaveBeenCalledWith({ storeId: 'store-1', asOf: undefined }));
        await waitFor(() => expect(shownRows()).toEqual(['Rahim Traders', 'Bhai Bhai Store', 'Fresh Mart', 'Corner Shop']));
    });

    it('reloads when the branch changes', async () => {
        render(<DueAgingReportPage />);
        await waitFor(() => expect(api.getDueAgingReport).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'all' } });

        await waitFor(() => expect(api.getDueAgingReport).toHaveBeenLastCalledWith({ storeId: 'all', asOf: undefined }));
    });

    it('reloads as of a picked date, and back to today when it is cleared', async () => {
        render(<DueAgingReportPage />);
        await waitFor(() => expect(api.getDueAgingReport).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-09-30' } });
        await waitFor(() => expect(api.getDueAgingReport).toHaveBeenLastCalledWith({ storeId: 'store-1', asOf: '2026-09-30' }));

        fireEvent.change(screen.getByLabelText('As of'), { target: { value: '' } });
        await waitFor(() => expect(api.getDueAgingReport).toHaveBeenLastCalledWith({ storeId: 'store-1', asOf: undefined }));
    });

    it('totals each age bracket over the customers shown', async () => {
        render(<DueAgingReportPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        expect(stat('0–30 days')).toContain('1,800');
        expect(stat('31–60 days')).toContain('2,000');
        expect(stat('61–90 days')).toContain('1,500');
        expect(stat('90+ days')).toContain('4,000');
        expect(stat('Total due')).toContain('9,300');

        fireEvent.change(screen.getByLabelText('Sales rep'), { target: { value: KARIM.id } });

        expect(stat('0–30 days')).toContain('1,000');
        expect(stat('Total due')).toContain('6,500');
    });

    it("opens on the viewer's own customers when they are someone's sales rep", async () => {
        api.getDueAgingReport.mockResolvedValue({ me: KARIM, rows: ROWS });
        render(<DueAgingReportPage />);

        await waitFor(() => expect(shownRows()).toEqual(['Rahim Traders', 'Fresh Mart']));
        expect(screen.getByLabelText('Sales rep')).toHaveValue('me');

        fireEvent.change(screen.getByLabelText('Sales rep'), { target: { value: '' } });
        expect(shownRows()).toHaveLength(4);
    });

    it('offers no "My customers" to a login linked to no employee', async () => {
        render(<DueAgingReportPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        expect(screen.queryByRole('option', { name: 'My customers' })).not.toBeInTheDocument();
    });

    it('filters to one sales rep, or to customers with none', async () => {
        render(<DueAgingReportPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        const options = within(screen.getByLabelText('Sales rep')).getAllByRole('option').map((o) => o.textContent);
        expect(options).toEqual(['All', 'Karim', 'Salma', 'No sales rep']);

        fireEvent.change(screen.getByLabelText('Sales rep'), { target: { value: SALMA.id } });
        expect(shownRows()).toEqual(['Bhai Bhai Store']);

        fireEvent.change(screen.getByLabelText('Sales rep'), { target: { value: 'none' } });
        expect(shownRows()).toEqual(['Corner Shop']);
    });

    it('narrows to customers with money overdue past an age', async () => {
        render(<DueAgingReportPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        fireEvent.change(screen.getByLabelText('Overdue'), { target: { value: '31' } });
        expect(shownRows()).toEqual(['Rahim Traders', 'Bhai Bhai Store', 'Fresh Mart']);

        fireEvent.change(screen.getByLabelText('Overdue'), { target: { value: '61' } });
        expect(shownRows()).toEqual(['Rahim Traders', 'Fresh Mart']);

        fireEvent.change(screen.getByLabelText('Overdue'), { target: { value: '91' } });
        expect(shownRows()).toEqual(['Rahim Traders']);
    });

    it('filters by customer group and by territory', async () => {
        render(<DueAgingReportPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));

        fireEvent.change(screen.getByLabelText('Group'), { target: { value: WHOLESALE.id } });
        expect(shownRows()).toEqual(['Rahim Traders', 'Bhai Bhai Store']);

        fireEvent.change(screen.getByLabelText('Territory'), { target: { value: MIRPUR.id } });
        expect(shownRows()).toEqual(['Rahim Traders']);
    });

    it('leaves out the group and territory filters and columns when no customer has one', async () => {
        api.getDueAgingReport.mockResolvedValue({ me: null, rows: [row('c4', 'Corner Shop', [300, 0, 0, 0])] });
        render(<DueAgingReportPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(1));

        expect(screen.queryByLabelText('Group')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Territory')).not.toBeInTheDocument();
        expect(screen.getByTestId('columns').textContent).not.toMatch(/group|territory/);
    });

    it('shows the branch column only across all branches', async () => {
        render(<DueAgingReportPage />);
        await waitFor(() => expect(shownRows()).toHaveLength(4));
        expect(screen.getByTestId('columns').textContent).not.toMatch(/branch/);

        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'all' } });

        await waitFor(() => expect(screen.getByTestId('columns').textContent).toMatch(/branch/));
    });

    it('survives a failed load', async () => {
        api.getDueAgingReport.mockRejectedValue(new Error('boom'));
        render(<DueAgingReportPage />);

        await waitFor(() => expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument());
        expect(shownRows()).toEqual([]);
    });
});
