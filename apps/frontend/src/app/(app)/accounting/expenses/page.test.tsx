import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// The table and the Created chip have suites of their own. The Date chip is a
// button that applies a fixed window, so each test reads what the page sends.
jest.mock('@/components/data-table', () => ({
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    CreatedRangeFilter: () => <div data-testid="created-range-filter" />,
    DateRangeFilter: ({ label, withTime, onChange }: { label: string; withTime?: boolean; onChange: (next: { from: string; to: string }) => void }) => (
        <button type="button" data-with-time={String(Boolean(withTime))} onClick={() => onChange({ from: '2026-10-01', to: '2026-10-13' })}>
            {`${label} range`}
        </button>
    ),
    DataTable: () => <div data-testid="data-table" />,
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
});
