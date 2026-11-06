import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FundTransfersPage from './page';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => ({ get: () => null }),
    usePathname: () => '/accounting/inter-branch/fund-transfers',
}));

// One object across renders, as the real hook's state is: the page copies
// the stores into its form whenever the list changes.
jest.mock('@/lib/accounting-report-scope', () => {
    const scope = {
        stores: [
            { id: 'store-a', name: 'Dhaka' },
            { id: 'store-b', name: 'Chattogram' },
        ],
        canConsolidate: true,
        loading: false,
    };
    return { useReportStores: () => scope };
});

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

type MockFilter = { id: string; more?: boolean; onChange: (next: unknown) => void; options?: { value: string }[] };

// The table has a suite of its own. This stand-in shows each row's id and
// actions, and keeps the props so a test can set a chip and read the strip.
let lastTableProps: {
    filterLayout?: string;
    data?: Array<{ id: string }>;
    columns?: Array<{ id?: string; cell?: (ctx: { row: { original: unknown } }) => React.ReactNode }>;
    filters?: MockFilter[];
    stats?: { items: { id: string; value: string; hint?: string }[] };
} | null = null;

jest.mock('@/components/data-table', () => ({
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    DataTable: (props: NonNullable<typeof lastTableProps>) => {
        lastTableProps = props;
        const actions = props.columns?.find((column) => column.id === 'actions');
        return (
            <div data-testid="data-table">
                {(props.data ?? []).map((row) => (
                    <div key={row.id} data-testid={`row-${row.id}`}>
                        {actions?.cell?.({ row: { original: row } })}
                    </div>
                ))}
                {(props.stats?.items ?? []).map((item) => (
                    <span key={item.id} data-testid={`stat-${item.id}`} data-hint={item.hint}>{item.value}</span>
                ))}
            </div>
        );
    },
}));

jest.mock('@/lib/api', () => ({
    api: {
        listFundTransfers: jest.fn(),
        receiveFundTransfer: jest.fn(),
        initiateFundTransfer: jest.fn(),
    },
}));

const DHAKA = { id: 'store-a', name: 'Dhaka' };
const CTG = { id: 'store-b', name: 'Chattogram' };

const TRANSFERS = [
    { id: 't1', amount: '5000', method: 'CASH', status: 'IN_TRANSIT', created_at: '2026-10-01T05:00:00Z', sourceStore: DHAKA, destinationStore: CTG },
    { id: 't2', amount: '12000', method: 'BANK_TRANSFER', status: 'RECEIVED', created_at: '2026-10-02T05:00:00Z', sourceStore: CTG, destinationStore: DHAKA },
    { id: 't3', amount: '3000', method: 'CASH', status: 'CANCELLED', created_at: '2026-10-03T05:00:00Z', sourceStore: DHAKA, destinationStore: CTG },
];

const money = (value: number) => formatBDT(value, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const stat = (id: string) => screen.getByTestId(`stat-${id}`).textContent;

function filter(id: string): MockFilter {
    const found = lastTableProps?.filters?.find((item) => item.id === id);
    if (!found) throw new Error(`No ${id} chip`);
    return found;
}

describe('FundTransfersPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        lastTableProps = null;
        mockBranchScope();
        (api.listFundTransfers as jest.Mock).mockResolvedValue(TRANSFERS);
        (api.receiveFundTransfer as jest.Mock).mockResolvedValue({});
    });

    it('holds its filters in the one-row toolbar', async () => {
        render(<FundTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('row-t1')).toBeInTheDocument());
        expect(lastTableProps?.filterLayout).toBe('row');
        expect(lastTableProps?.filters?.map((item) => item.id)).toEqual(['created', 'status', 'from', 'to', 'amount', 'method']);
        expect(filter('from').options?.map((option) => option.value)).toEqual(['store-b', 'store-a']);
    });

    it('narrows the rows and the strip with the status and branch chips', async () => {
        render(<FundTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('row-t1')).toBeInTheDocument());

        expect(stat('count')).toBe('3');
        expect(stat('amount')).toBe(money(20_000));
        expect(stat('inTransit')).toBe(money(5_000));
        expect(stat('received')).toBe(money(12_000));

        act(() => filter('from').onChange(['store-a']));
        expect(screen.queryByTestId('row-t2')).not.toBeInTheDocument();
        expect(stat('amount')).toBe(money(8_000));

        act(() => filter('status').onChange(['CANCELLED']));
        expect(screen.queryByTestId('row-t1')).not.toBeInTheDocument();
        expect(stat('count')).toBe('1');
        expect(stat('cancelled')).toBe(money(3_000));
        // Status and branch narrow the loaded rows; only the date goes to the server.
        expect(api.listFundTransfers).toHaveBeenCalledTimes(1);
    });

    it('marks an in-transit transfer received from its row', async () => {
        render(<FundTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('row-t1')).toBeInTheDocument());

        expect(within(screen.getByTestId('row-t2')).queryByRole('button')).not.toBeInTheDocument();
        fireEvent.click(within(screen.getByTestId('row-t1')).getByRole('button', { name: 'Mark Received' }));

        await waitFor(() => expect(api.receiveFundTransfer).toHaveBeenCalledWith('t1'));
    });
});
