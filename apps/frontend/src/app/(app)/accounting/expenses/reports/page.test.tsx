import { fireEvent, render, screen } from '@testing-library/react';
import ExpenseReportsPage from './page';
import { api } from '@/lib/api';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

jest.mock('@/components/data-table', () => ({
    DataTable: ({ title, data }: { title: string; data: unknown[] }) => (
        <div data-testid="report-table">{title}:{data.length}</div>
    ),
}));

jest.mock('@/lib/api', () => ({
    api: { getExpenseSummary: jest.fn() },
}));

const summary = {
    total: 400,
    expenseToRevenueRatio: 0.4,
    byCategory: [
        {
            categoryId: 'cat-salary',
            name: 'Salary',
            amount: 400,
            sharePct: 100,
            heads: [
                { headId: 'head-karim', name: 'Salary - Karim', amount: 300, sharePct: 75 },
                { headId: 'head-rahim', name: 'Salary - Rahim', amount: 100, sharePct: 25 },
            ],
        },
    ],
    monthlyTrend: [{ month: '2026-10', amount: 400 }],
    dailyTrend: [
        { date: '2026-10-01', amount: 300 },
        { date: '2026-10-08', amount: 100 },
    ],
};

describe('ExpenseReportsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        (api.getExpenseSummary as jest.Mock).mockResolvedValue(summary);
    });

    it('shows one report at a time, and a period can be a month, week, or day', async () => {
        render(<ExpenseReportsPage />);

        expect(await screen.findByRole('tab', { name: 'Monthly trend' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('report-table')).toHaveTextContent('Monthly trend:1');

        fireEvent.click(screen.getByRole('tab', { name: 'By category' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By category:1');

        fireEvent.click(screen.getByRole('tab', { name: 'By expense head' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By expense head:2');

        fireEvent.click(screen.getByRole('tab', { name: 'By period' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By period:1');

        fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By period:2');

        fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
        expect(screen.getByTestId('report-table')).toHaveTextContent('By period:2');
    });
});
