import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ExpensesPage from './page';
import { api } from '@/lib/api';
import { createdRangeFromPreset } from '@/lib/created-range';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => ({ get: () => null }),
    usePathname: () => '/accounting',
}));

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

// The table has a suite of its own. This stand-in exposes the filter row and
// the strip so the page test can see what they are set to.
let lastTableProps: {
    filterLayout?: string;
    viewOptions?: boolean;
    enableColumnFilters?: boolean;
    data?: unknown[];
    filters?: Array<{ id: string; type: string; more?: boolean; operators?: boolean; withTime?: boolean }>;
} | null = null;

jest.mock('@/components/data-table', () => ({
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    DataTable: (props: {
        filterLayout?: string;
        viewOptions?: boolean;
        enableColumnFilters?: boolean;
        data?: unknown[];
        searchValue?: string;
        onSearchChange?: (next: string) => void;
        stats?: { items?: { id: string; value: string }[] };
        filters?: Array<{
            id: string;
            type: string;
            label?: string;
            more?: boolean;
            operators?: boolean;
            withTime?: boolean;
            value?: unknown;
            onChange?: (next: unknown) => void;
            options?: { value: string; label: string }[];
        }>;
    }) => {
        lastTableProps = props;
        return (
            <div data-testid="data-table" data-filter-layout={props.filterLayout}>
                <input
                    aria-label="search"
                    value={props.searchValue ?? ''}
                    onChange={(event) => props.onSearchChange?.(event.target.value)}
                />
                <div data-testid="stats">
                    {(props.stats?.items ?? []).map((item) => (
                        <span key={item.id} data-testid={`stat-${item.id}`}>{item.value}</span>
                    ))}
                </div>
                <div data-testid="row-count">{props.data?.length ?? 0}</div>
                {(props.filters ?? []).map((filter) => {
                    if (filter.type === 'date-range' && filter.id === 'expenseDate') {
                        return (
                            <button
                                key={filter.id}
                                type="button"
                                data-with-time={String(Boolean(filter.withTime))}
                                data-operators={String(Boolean(filter.operators))}
                                onClick={() => filter.onChange?.({ from: '2026-10-01', to: '2026-10-13' })}
                            >
                                {`${filter.label} range`}
                            </button>
                        );
                    }
                    if (filter.type === 'date-range') {
                        return (
                            <div
                                key={filter.id}
                                data-testid="created-range-filter"
                                data-more={String(Boolean(filter.more))}
                                data-operators={String(Boolean(filter.operators))}
                            />
                        );
                    }
                    if (filter.type === 'multi-select') {
                        const selected = Array.isArray(filter.value) ? filter.value[0] ?? '' : '';
                        return (
                            <select
                                key={filter.id}
                                aria-label={filter.label}
                                value={selected}
                                onChange={(event) => filter.onChange?.(event.target.value ? [event.target.value] : [])}
                            >
                                <option value="">All</option>
                                {(filter.options ?? []).map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        );
                    }
                    if (filter.type === 'number') {
                        return (
                            <button key={filter.id} type="button" onClick={() => filter.onChange?.({ op: 'gt', value: 60 })}>
                                Amount over 60
                            </button>
                        );
                    }
                    return <div key={filter.id} />;
                })}
            </div>
        );
    },
}));

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getExpenseEntries: jest.fn(),
        getExpenseCategories: jest.fn(),
        createExpenseEntry: jest.fn(),
        deleteExpenseEntry: jest.fn(),
    },
}));

describe('ExpensesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        (api.getExpenseEntries as jest.Mock).mockResolvedValue([]);
        (api.getExpenseCategories as jest.Mock).mockResolvedValue([]);
    });

    it('opens on this month of expense dates and narrows through the Date chip', async () => {
        render(<ExpensesPage />);

        const month = createdRangeFromPreset('thisMonth');
        await waitFor(() =>
            expect(api.getExpenseEntries).toHaveBeenCalledWith(
                expect.objectContaining({ from: month.from, to: month.to }),
            ),
        );
        // expense_date has no time of day, so neither does its chip.
        expect(screen.getByRole('button', { name: 'Date range' })).toHaveAttribute('data-with-time', 'false');
        expect(screen.getByTestId('created-range-filter')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Date range' }));

        await waitFor(() =>
            expect(api.getExpenseEntries).toHaveBeenLastCalledWith(
                expect.objectContaining({ from: '2026-10-01', to: '2026-10-13' }),
            ),
        );
    });

    it('records an expense against a head, grouped under its category', async () => {
        (api.getExpenseCategories as jest.Mock).mockResolvedValue([
            {
                id: 'cat-salary',
                name: 'Salary',
                heads: [
                    { id: 'head-karim', name: 'Salary - Karim' },
                    { id: 'head-rahim', name: 'Salary - Rahim' },
                ],
            },
        ]);
        (api.createExpenseEntry as jest.Mock).mockResolvedValue({ id: 'entry-1' });

        render(<ExpensesPage />);
        expect(await screen.findByRole('option', { name: 'Salary' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /add expense/i }));

        const dialog = screen.getByRole('dialog');
        const headSelect = within(dialog).getByRole('combobox', { name: /expense head/i });
        expect(within(dialog).getByRole('option', { name: 'Salary - Karim' })).toBeInTheDocument();
        expect(within(dialog).queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument();

        fireEvent.change(headSelect, { target: { value: 'head-karim' } });
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '500' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

        await waitFor(() =>
            expect(api.createExpenseEntry).toHaveBeenCalledWith(
                expect.objectContaining({ headId: 'head-karim', amount: 500 }),
            ),
        );
        expect(api.createExpenseEntry).not.toHaveBeenCalledWith(
            expect.objectContaining({ categoryId: expect.anything() }),
        );
    });

    it('keeps the Sales list row, and narrows the loaded rows from the chips', async () => {
        (api.getExpenseEntries as jest.Mock).mockResolvedValue([
            {
                id: '1',
                amount: '100',
                payment_method: 'CASH',
                expense_date: '2026-10-02',
                created_at: '2026-10-02T00:00:00.000Z',
                description: 'Rent bill',
                category: { id: 'cat-rent', name: 'Rent' },
                head: { id: 'head-rent', name: 'Shop rent' },
            },
            {
                id: '2',
                amount: '50',
                payment_method: 'BKASH',
                expense_date: '2026-10-03',
                created_at: '2026-10-03T00:00:00.000Z',
                description: null,
                category: { id: 'cat-util', name: 'Utilities' },
                head: { id: 'head-util', name: 'Power' },
            },
        ]);
        (api.getExpenseCategories as jest.Mock).mockResolvedValue([
            { id: 'cat-rent', name: 'Rent', heads: [{ id: 'head-rent', name: 'Shop rent' }] },
            { id: 'cat-util', name: 'Utilities', heads: [{ id: 'head-util', name: 'Power' }] },
        ]);

        render(<ExpensesPage />);

        expect(await screen.findByTestId('stat-count')).toHaveTextContent('2');
        expect(screen.getByTestId('stat-total')).toHaveTextContent('150.00');
        expect(screen.getByTestId('stat-cash')).toHaveTextContent('100.00');
        expect(screen.getByTestId('stat-other')).toHaveTextContent('50.00');
        expect(screen.getByTestId('data-table')).toHaveAttribute('data-filter-layout', 'row');
        expect(screen.getByTestId('created-range-filter')).toHaveAttribute('data-more', 'true');
        expect(screen.getByTestId('created-range-filter')).toHaveAttribute('data-operators', 'true');
        expect(lastTableProps?.viewOptions).toBe(true);
        expect(lastTableProps?.enableColumnFilters).toBe(false);
        const request = (api.getExpenseEntries as jest.Mock).mock.calls[0][0];
        expect(request.categoryId).toBeUndefined();
        expect(request.headId).toBeUndefined();

        const callsBeforeChip = (api.getExpenseEntries as jest.Mock).mock.calls.length;
        fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'cat-rent' } });
        expect(screen.getByTestId('row-count')).toHaveTextContent('1');
        expect(screen.getByTestId('stat-total')).toHaveTextContent('100.00');
        expect(api.getExpenseEntries).toHaveBeenCalledTimes(callsBeforeChip);

        fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: '' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'search' }), { target: { value: 'power' } });
        expect(screen.getByTestId('row-count')).toHaveTextContent('1');
        expect(screen.getByTestId('stat-total')).toHaveTextContent('50.00');

        fireEvent.change(screen.getByRole('textbox', { name: 'search' }), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Amount over 60' }));
        expect(screen.getByTestId('row-count')).toHaveTextContent('1');
        expect(screen.getByTestId('stat-total')).toHaveTextContent('100.00');
    });
});
