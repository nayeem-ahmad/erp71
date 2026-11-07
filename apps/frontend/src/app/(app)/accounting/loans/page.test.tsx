import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LoansPage from './page';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
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

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

type MockFilter = { id: string; type: string; more?: boolean; withTime?: boolean; value?: unknown; onChange: (next: unknown) => void };
type MockColumn = { id?: string; accessorKey?: string; cell?: (ctx: { row: { original: unknown } }) => React.ReactNode };

// The table has a suite of its own. This stand-in shows each row's
// counterparty and actions, and keeps the props so a test can set a chip.
let lastTableProps: {
    filterLayout?: string;
    enableColumnFilters?: boolean;
    data?: Array<{ counterparty: string }>;
    columns?: MockColumn[];
    filters?: MockFilter[];
    stats?: { items: { id: string; value: string; hint?: string }[] };
} | null = null;

jest.mock('@/components/data-table', () => ({
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    DataTable: (props: NonNullable<typeof lastTableProps>) => {
        lastTableProps = props;
        const actions = props.columns?.find((column) => column.id === 'actions');
        return (
            <div data-testid="data-table" data-filter-layout={props.filterLayout}>
                {(props.data ?? []).map((row) => (
                    <div key={row.counterparty} data-testid={`row-${row.counterparty}`}>
                        {row.counterparty}
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
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getLoans: jest.fn(),
        deleteLoan: jest.fn(),
    },
}));

const LOANS = [
    {
        id: 'loan-1',
        counterparty: 'City Bank',
        direction: 'PAYABLE',
        principal: '100000',
        start_date: '2026-01-10T00:00:00.000Z',
        due_date: '2026-03-01T00:00:00.000Z',
        status: 'ACTIVE',
        total_paid: 40000,
        outstanding: 60000,
        created_at: '2026-01-10T00:00:00.000Z',
    },
    {
        id: 'loan-2',
        counterparty: 'Rahim Traders',
        direction: 'RECEIVABLE',
        principal: '20000',
        start_date: '2026-02-01T00:00:00.000Z',
        due_date: null,
        status: 'ACTIVE',
        total_paid: 5000,
        outstanding: 15000,
        created_at: '2026-02-01T00:00:00.000Z',
    },
    {
        id: 'loan-3',
        counterparty: 'Karim',
        direction: 'PAYABLE',
        principal: '10000',
        start_date: '2025-06-01T00:00:00.000Z',
        due_date: '2025-12-01T00:00:00.000Z',
        status: 'CLOSED',
        total_paid: 10000,
        outstanding: 0,
        created_at: '2025-06-01T00:00:00.000Z',
    },
];

function filter(id: string): MockFilter {
    const found = lastTableProps?.filters?.find((item) => item.id === id);
    if (!found) throw new Error(`No ${id} chip`);
    return found;
}

const stat = (id: string) => screen.getByTestId(`stat-${id}`).textContent;
const money = (value: number) => formatBDT(value, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 });

describe('LoansPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        lastTableProps = null;
        mockBranchScope();
        (api.getLoans as jest.Mock).mockResolvedValue(LOANS);
        (api.deleteLoan as jest.Mock).mockResolvedValue({});
    });

    it('puts its filters in the one-row toolbar, the rarer ones behind More', async () => {
        render(<LoansPage />);
        await waitFor(() => expect(screen.getByTestId('row-City Bank')).toBeInTheDocument());

        expect(lastTableProps?.filterLayout).toBe('row');
        expect(lastTableProps?.enableColumnFilters).toBe(false);
        expect(lastTableProps?.filters?.map((item) => item.id)).toEqual([
            'direction', 'status', 'startDate', 'principal', 'outstanding', 'overdue', 'dueDate', 'created',
        ]);
        expect(lastTableProps?.filters?.filter((item) => item.more).map((item) => item.id)).toEqual(['dueDate', 'created']);
    });

    it('sends the start-date chip to the server, apart from Created', async () => {
        render(<LoansPage />);
        await waitFor(() => expect(api.getLoans).toHaveBeenCalled());

        act(() => filter('startDate').onChange({ from: '2026-10-01', to: '2026-10-13' }));

        await waitFor(() =>
            expect(api.getLoans).toHaveBeenLastCalledWith(
                expect.objectContaining({ dateFrom: '2026-10-01', dateTo: '2026-10-13' }),
            ),
        );
        expect((api.getLoans as jest.Mock).mock.lastCall[0]).not.toHaveProperty('createdFrom');
    });

    it('narrows the rows and the strip with the type chip', async () => {
        render(<LoansPage />);
        await waitFor(() => expect(screen.getByTestId('row-City Bank')).toBeInTheDocument());

        expect(stat('count')).toBe('3');
        expect(stat('principal')).toBe(money(130_000));
        expect(stat('owedByYou')).toBe(money(60_000));
        expect(stat('owedToYou')).toBe(money(15_000));

        act(() => filter('direction').onChange(['PAYABLE']));

        expect(screen.queryByTestId('row-Rahim Traders')).not.toBeInTheDocument();
        expect(stat('count')).toBe('2');
        expect(stat('principal')).toBe(money(110_000));
        expect(stat('repaid')).toBe(money(50_000));
        expect(stat('owedToYou')).toBe(money(0));
        // The one search call per load: the type chip narrows the loaded rows.
        expect(api.getLoans).toHaveBeenCalledTimes(1);
    });

    it('counts an open loan past its due date as overdue', async () => {
        render(<LoansPage />);
        await waitFor(() => expect(screen.getByTestId('row-City Bank')).toBeInTheDocument());

        expect(stat('overdue')).toBe(money(60_000));

        act(() => filter('overdue').onChange(true));

        expect(screen.getByTestId('row-City Bank')).toBeInTheDocument();
        expect(screen.queryByTestId('row-Karim')).not.toBeInTheDocument();
        expect(screen.queryByTestId('row-Rahim Traders')).not.toBeInTheDocument();
    });

    it('asks in a dialog before deleting a loan', async () => {
        const confirmSpy = jest.spyOn(globalThis, 'confirm');
        render(<LoansPage />);
        await waitFor(() => expect(screen.getByTestId('row-Karim')).toBeInTheDocument());

        fireEvent.click(within(screen.getByTestId('row-Karim')).getByRole('button', { name: 'Delete' }));

        const dialog = await screen.findByText('Delete loan?');
        expect(dialog).toBeInTheDocument();
        expect(api.deleteLoan).not.toHaveBeenCalled();

        const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => expect(api.deleteLoan).toHaveBeenCalledWith('loan-3'));
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});
