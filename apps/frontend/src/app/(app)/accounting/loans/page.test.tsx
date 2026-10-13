import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoansPage from './page';
import { api } from '@/lib/api';
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
        getLoans: jest.fn(),
        getLoanSummary: jest.fn(),
    },
}));

describe('LoansPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        (api.getLoans as jest.Mock).mockResolvedValue([]);
        (api.getLoanSummary as jest.Mock).mockResolvedValue(null);
    });

    it('filters by start date through the Date chip, apart from Created', async () => {
        render(<LoansPage />);
        await waitFor(() => expect(api.getLoans).toHaveBeenCalled());

        expect(screen.getByRole('button', { name: 'Date range' })).toHaveAttribute('data-with-time', 'false');
        expect(screen.getByTestId('created-range-filter')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Date range' }));

        await waitFor(() =>
            expect(api.getLoans).toHaveBeenLastCalledWith(
                expect.objectContaining({ dateFrom: '2026-10-01', dateTo: '2026-10-13' }),
            ),
        );
        expect((api.getLoans as jest.Mock).mock.lastCall[0]).not.toHaveProperty('createdFrom');
    });
});
