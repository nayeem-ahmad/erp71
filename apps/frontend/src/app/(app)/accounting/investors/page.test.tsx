import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InvestorsPage from './page';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => ({ get: () => null }),
    usePathname: () => '/accounting/investors',
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

type MockFilter = { id: string; more?: boolean; onChange: (next: unknown) => void };

// The table has a suite of its own. This stand-in shows each row's name and
// actions, and keeps the props so a test can set a chip and read the strip.
let lastTableProps: {
    filterLayout?: string;
    data?: Array<{ id: string; name: string }>;
    columns?: Array<{ id?: string; cell?: (ctx: { row: { original: unknown } }) => React.ReactNode }>;
    filters?: MockFilter[];
    stats?: { items: { id: string; value: string }[] };
} | null = null;

jest.mock('@/components/data-table', () => ({
    DataTable: (props: NonNullable<typeof lastTableProps>) => {
        lastTableProps = props;
        const actions = props.columns?.find((column) => column.id === 'actions');
        return (
            <div data-testid="data-table">
                {(props.data ?? []).map((row) => (
                    <div key={row.id} data-testid={`row-${row.id}`}>
                        {row.name}
                        {actions?.cell?.({ row: { original: row } })}
                    </div>
                ))}
                {(props.stats?.items ?? []).map((item) => (
                    <span key={item.id} data-testid={`stat-${item.id}`}>{item.value}</span>
                ))}
            </div>
        );
    },
}));

jest.mock('@/lib/api', () => ({
    api: {
        getInvestors: jest.fn(),
        deleteInvestor: jest.fn(),
    },
}));

const INVESTORS = [
    { id: 'i1', name: 'Asha', profit_share_pct: '10', status: 'ACTIVE', joined_on: '2025-01-01', loss_carry_forward: 0, capital_balance: 500000, profit_accrued: 30000, profit_paid: 20000, profit_outstanding: 10000 },
    { id: 'i2', name: 'Babul', profit_share_pct: '5', status: 'ACTIVE', joined_on: '2026-03-01', loss_carry_forward: 0, capital_balance: 200000, profit_accrued: 8000, profit_paid: 8000, profit_outstanding: 0 },
    { id: 'i3', name: 'Chandra', profit_share_pct: '7.5', status: 'EXITED', joined_on: '2024-06-01', loss_carry_forward: 0, capital_balance: 0, profit_accrued: 12000, profit_paid: 12000, profit_outstanding: 0 },
];

const money = (value: number) => formatBDT(value, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const stat = (id: string) => screen.getByTestId(`stat-${id}`).textContent;

function filter(id: string): MockFilter {
    const found = lastTableProps?.filters?.find((item) => item.id === id);
    if (!found) throw new Error(`No ${id} chip`);
    return found;
}

describe('InvestorsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        lastTableProps = null;
        mockBranchScope();
        (api.getInvestors as jest.Mock).mockResolvedValue(INVESTORS);
        (api.deleteInvestor as jest.Mock).mockResolvedValue({});
    });

    it('narrows the rows and the strip with the status chip', async () => {
        render(<InvestorsPage />);
        await waitFor(() => expect(screen.getByTestId('row-i1')).toBeInTheDocument());

        expect(lastTableProps?.filterLayout).toBe('row');
        expect(lastTableProps?.filters?.map((item) => item.id)).toEqual(['status', 'joinedOn', 'capital', 'unpaid', 'share']);
        expect(stat('count')).toBe('3');
        expect(stat('capital')).toBe(money(700_000));
        expect(stat('committed')).toBe('15.00%');
        expect(stat('unpaid')).toBe(money(10_000));

        act(() => filter('status').onChange(['EXITED']));

        expect(screen.queryByTestId('row-i1')).not.toBeInTheDocument();
        expect(stat('count')).toBe('1');
        expect(stat('declared')).toBe(money(12_000));
        expect(api.getInvestors).toHaveBeenCalledTimes(1);
    });

    it('asks in a dialog before deleting an investor', async () => {
        render(<InvestorsPage />);
        await waitFor(() => expect(screen.getByTestId('row-i2')).toBeInTheDocument());

        fireEvent.click(within(screen.getByTestId('row-i2')).getByRole('button', { name: 'Delete' }));
        expect(await screen.findByText('Delete investor?')).toBeInTheDocument();
        expect(api.deleteInvestor).not.toHaveBeenCalled();

        const buttons = screen.getAllByRole('button', { name: 'Delete' });
        fireEvent.click(buttons[buttons.length - 1]);

        await waitFor(() => expect(api.deleteInvestor).toHaveBeenCalledWith('i2'));
    });
});
