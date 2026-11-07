import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ExpenseReportsPage from './page';
import { api } from '@/lib/api';
import { createdRangeFromPreset } from '@/lib/created-range';
import { mockBranchScope } from '@/test-utils/branch-scope';
import type { ListFilter, ListStat } from '@/components/data-table';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

// The table's own rows, strip and chips, drawn plainly: a multi-select chip
// becomes one button per option that picks just that option.
jest.mock('@/components/data-table', () => ({
    DataTable: ({ title, data, stats, filters }: {
        title: string;
        data: unknown[];
        stats?: { items: ListStat[]; label: string };
        filters?: ListFilter[];
    }) => (
        <div>
            <div data-testid="report-table">{title}:{data.length}</div>
            <ul aria-label={stats?.label}>
                {stats?.items.map((item) => (
                    <li key={item.id}>{item.label}: {item.value}{item.hint ? ` (${item.hint})` : ''}</li>
                ))}
            </ul>
            {filters?.map((filter) => (filter.type === 'multi-select'
                ? filter.options.map((option) => (
                    <button key={`${filter.id}-${option.value}`} type="button" onClick={() => filter.onChange([option.value])}>
                        {filter.label}={option.label}
                    </button>
                ))
                : filter.type === 'date-range'
                    ? (
                        <button key={filter.id} type="button" onClick={() => filter.onChange(null)}>
                            clear {filter.label}
                        </button>
                    )
                    : null))}
        </div>
    ),
}));

jest.mock('@/lib/api', () => ({
    api: { getExpenseSummary: jest.fn() },
}));

const summary = {
    total: 500,
    expenseToRevenueRatio: 0.4,
    byCategory: [
        {
            categoryId: 'cat-salary',
            name: 'Salary',
            amount: 400,
            sharePct: 80,
            heads: [
                { headId: 'head-karim', name: 'Salary - Karim', amount: 300, sharePct: 60 },
                { headId: 'head-rahim', name: 'Salary - Rahim', amount: 100, sharePct: 20 },
            ],
        },
        {
            categoryId: 'cat-rent',
            name: 'Rent',
            amount: 100,
            sharePct: 20,
            heads: [{ headId: 'head-shop', name: 'Shop rent', amount: 100, sharePct: 20 }],
        },
    ],
    monthlyTrend: [{ month: '2026-10', amount: 500 }],
    dailyTrend: [
        { date: '2026-10-01', amount: 400 },
        { date: '2026-10-08', amount: 100 },
    ],
};

const strip = () => within(screen.getByRole('list', { name: 'Expense report summary' }));

describe('ExpenseReportsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        (api.getExpenseSummary as jest.Mock).mockResolvedValue(summary);
    });

    it('shows one report at a time, and a period can be a month, week, or day', async () => {
        render(<ExpenseReportsPage />);

        expect(await screen.findByRole('tab', { name: 'Monthly trend' })).toHaveAttribute('aria-selected', 'true');
        await waitFor(() => expect(screen.getByTestId('report-table')).toHaveTextContent('Monthly trend:1'));

        fireEvent.click(screen.getByRole('tab', { name: 'By category' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By category:2');

        fireEvent.click(screen.getByRole('tab', { name: 'By expense head' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By expense head:3');

        fireEvent.click(screen.getByRole('tab', { name: 'By period' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By period:1');

        fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By period:2');

        fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By period:2');
    });

    it('opens on the last six months, and a cleared period falls back to it', async () => {
        render(<ExpenseReportsPage />);
        const lastSix = createdRangeFromPreset('last6Months');

        await waitFor(() => expect(api.getExpenseSummary).toHaveBeenCalledWith({
            storeId: 'store-1',
            from: lastSix.from,
            to: lastSix.to,
        }));

        fireEvent.click(screen.getByRole('button', { name: 'clear Period' }));
        // Still the same window, so nothing is asked again.
        expect(api.getExpenseSummary).toHaveBeenCalledTimes(1);
    });

    it('narrows the head report by category, and its strip sums only those heads', async () => {
        render(<ExpenseReportsPage />);
        await waitFor(() => expect(api.getExpenseSummary).toHaveBeenCalled());
        fireEvent.click(await screen.findByRole('tab', { name: 'By expense head' }));

        await waitFor(() => expect(strip().getByText(/Total expenses/)).toHaveTextContent(/৳\s?500/));
        expect(strip().getByText(/Expense \/ revenue/)).toHaveTextContent('40.0%');

        fireEvent.click(screen.getByRole('button', { name: 'Category=Salary' }));

        expect(screen.getByTestId('report-table')).toHaveTextContent('By expense head:2');
        expect(strip().getByText(/Total expenses/)).toHaveTextContent(/৳\s?400/);
        expect(strip().getByText(/^Heads/)).toHaveTextContent('2');
        expect(strip().getByText(/Top head/)).toHaveTextContent('Salary - Karim');
        // The head chip now offers only the picked category's heads.
        expect(screen.queryByRole('button', { name: /Shop rent/ })).not.toBeInTheDocument();
    });
});
