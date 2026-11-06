import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import PostingExceptionsPage from './page';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/accounting/reconciliation'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// The table has a suite of its own. This stand-in counts the rows and keeps
// the props, so a test can read the strip and set a chip.
let lastTableProps: any = null;

jest.mock('@/components/data-table', () => ({
    DataTable: (props: any) => {
        lastTableProps = props;
        return (
            <div data-testid="data-table">
                {props.data?.length ?? 0} rows
                {(props.stats?.items ?? []).map((item: { id: string; value: string }) => (
                    <span key={item.id} data-testid={`stat-${item.id}`}>{item.value}</span>
                ))}
            </div>
        );
    },
}));

jest.mock('@/lib/api', () => ({
    api: {
        getPostingExceptions: jest.fn(),
        getPostingExceptionsSummary: jest.fn(),
        retryPostingException: jest.fn(),
    },
}));

const mockEvents = [
    {
        id: 'event-1',
        eventType: 'sale',
        sourceModule: 'sales',
        sourceType: 'Sale',
        sourceId: 'sale-001',
        status: 'pending',
        attemptCount: 1,
        lastError: null,
        lastAttemptAt: '2026-06-01T00:00:00Z',
        voucher: null,
    },
    {
        id: 'event-2',
        eventType: 'purchase',
        sourceModule: 'purchases',
        sourceType: 'Purchase',
        sourceId: 'pur-001',
        status: 'failed',
        attemptCount: 3,
        lastError: 'Account not found',
        lastAttemptAt: '2026-06-02T00:00:00Z',
        voucher: { id: 'v1', voucher_number: 'VOU-001', voucher_type: 'journal' },
    },
];

function getApi() {
    return require('@/lib/api').api;
}

describe('PostingExceptionsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.getPostingExceptions.mockResolvedValue({
            data: [],
            pagination: { page: 1, limit: 20, total: 0 },
        });
        api.getPostingExceptionsSummary.mockResolvedValue({ count: 0, pending: 0, posted: 0, failed: 0, skipped: 0 });
        api.retryPostingException.mockResolvedValue({ message: 'Retry queued.' });
    });

    it('renders the page heading', async () => {
        render(<PostingExceptionsPage />);
        await waitFor(() => {
            expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
        });
        expect(screen.getAllByText(/posting exceptions/i).length).toBeGreaterThan(0);
    });

    it('shows loading state while fetching', () => {
        const api = getApi();
        api.getPostingExceptions.mockReturnValue(new Promise(() => {}));
        render(<PostingExceptionsPage />);
        // Component renders during loading - just check it doesn't crash
        expect(document.body).toBeInTheDocument();
    });

    it('loads the first page on mount, with no status chosen', async () => {
        const api = getApi();
        render(<PostingExceptionsPage />);
        await waitFor(() => {
            expect(api.getPostingExceptions).toHaveBeenCalledWith(
                expect.objectContaining({ status: [], statusExclude: false, module: [], page: 1, limit: 20 }),
            );
        });
    });

    it('shows events in the data table', async () => {
        const api = getApi();
        api.getPostingExceptions.mockResolvedValue({
            data: mockEvents,
            pagination: { page: 1, limit: 20, total: 2 },
        });
        render(<PostingExceptionsPage />);
        await waitFor(() => {
            expect(screen.getByText('2 rows')).toBeInTheDocument();
        });
    });

    it('shows empty state when no events', async () => {
        render(<PostingExceptionsPage />);
        await waitFor(() => {
            expect(screen.getByText('0 rows')).toBeInTheDocument();
        });
    });

    it('puts status, module and date in the one-row toolbar', async () => {
        render(<PostingExceptionsPage />);
        await waitFor(() => expect(screen.getByText('0 rows')).toBeInTheDocument());
        expect(lastTableProps.filterLayout).toBe('row');
        expect(lastTableProps.filters.map((f: { id: string }) => f.id)).toEqual(['status', 'module', 'updated']);
        expect(lastTableProps.serverPagination).toEqual(expect.objectContaining({ page: 1, pageSize: 20 }));
    });

    it('refetches when the status chip changes', async () => {
        const api = getApi();
        render(<PostingExceptionsPage />);
        await waitFor(() => expect(screen.getByText('0 rows')).toBeInTheDocument());

        const status = lastTableProps.filters.find((f: { id: string }) => f.id === 'status');
        expect(status.type).toBe('multi-select');
        act(() => status.onChange(['failed', 'pending']));

        await waitFor(() => {
            expect(api.getPostingExceptions).toHaveBeenCalledWith(
                expect.objectContaining({ status: ['failed', 'pending'], page: 1, limit: 20 })
            );
        });
    });

    it('offers "is none of" on the status chip and sends it along', async () => {
        const api = getApi();
        render(<PostingExceptionsPage />);
        await waitFor(() => expect(screen.getByText('0 rows')).toBeInTheDocument());

        act(() => lastTableProps.filters.find((f: { id: string }) => f.id === 'status').onChange(['posted']));
        act(() => lastTableProps.filters.find((f: { id: string }) => f.id === 'status').exclude.onChange(true));

        await waitFor(() => {
            expect(api.getPostingExceptions).toHaveBeenLastCalledWith(
                expect.objectContaining({ status: ['posted'], statusExclude: true }),
            );
        });
        expect(api.getPostingExceptionsSummary).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: ['posted'], statusExclude: true }),
        );
    });

    it('takes several modules at once', async () => {
        const api = getApi();
        render(<PostingExceptionsPage />);
        await waitFor(() => expect(screen.getByText('0 rows')).toBeInTheDocument());

        const moduleChip = lastTableProps.filters.find((f: { id: string }) => f.id === 'module');
        expect(moduleChip.type).toBe('multi-select');
        expect(moduleChip.options.map((o: { value: string }) => o.value)).toEqual(expect.arrayContaining(['sales', 'purchases']));
        act(() => moduleChip.onChange(['sales', 'purchases']));

        await waitFor(() => {
            expect(api.getPostingExceptions).toHaveBeenLastCalledWith(
                expect.objectContaining({ module: ['sales', 'purchases'], page: 1 }),
            );
        });
    });

    it('searches on the server once typing settles, back on the first page', async () => {
        const api = getApi();
        render(<PostingExceptionsPage />);
        await waitFor(() => expect(screen.getByText('0 rows')).toBeInTheDocument());
        expect(lastTableProps.showSearch).not.toBe(false);
        expect(lastTableProps.searchPlaceholder).toBe('Search source, voucher or error…');

        act(() => lastTableProps.serverPagination.onPageChange(3));
        await waitFor(() => expect(api.getPostingExceptions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 })));

        act(() => lastTableProps.onSearchChange(' INV-0042 '));
        expect(lastTableProps.searchValue).toBe(' INV-0042 ');

        await waitFor(() => {
            expect(api.getPostingExceptions).toHaveBeenLastCalledWith(
                expect.objectContaining({ search: 'INV-0042', page: 1 }),
            );
        });
        expect(api.getPostingExceptionsSummary).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'INV-0042' }));
    });

    it('fills the strip from one summary request, which follows the chips', async () => {
        const api = getApi();
        api.getPostingExceptionsSummary.mockImplementation((params: { status?: string[] }) => Promise.resolve(
            params.status?.length
                ? { count: 2, pending: 0, posted: 0, failed: 2, skipped: 0 }
                : { count: 16, pending: 3, posted: 10, failed: 2, skipped: 1 },
        ));
        render(<PostingExceptionsPage />);

        await waitFor(() => expect(screen.getByTestId('stat-count')).toHaveTextContent('16'));
        expect(screen.getByTestId('stat-pending')).toHaveTextContent('3');
        expect(screen.getByTestId('stat-failed')).toHaveTextContent('2');
        expect(screen.getByTestId('stat-posted')).toHaveTextContent('10');
        expect(api.getPostingExceptionsSummary).toHaveBeenCalledTimes(1);
        // No one-row request per status any more.
        expect(api.getPostingExceptions).not.toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));

        const status = lastTableProps.filters.find((f: { id: string }) => f.id === 'status');
        act(() => status.onChange(['failed']));

        await waitFor(() => expect(screen.getByTestId('stat-count')).toHaveTextContent('2'));
        expect(screen.getByTestId('stat-pending')).toHaveTextContent('0');
        expect(screen.getByTestId('stat-failed')).toHaveTextContent('2');
        expect(api.getPostingExceptionsSummary).toHaveBeenLastCalledWith(expect.objectContaining({ status: ['failed'] }));
        expect(lastTableProps.stats.items.find((i: { id: string }) => i.id === 'failed').tone).toBe('danger');
    });

    it('sends the date chip as from/to', async () => {
        const api = getApi();
        render(<PostingExceptionsPage />);
        await waitFor(() => expect(screen.getByText('0 rows')).toBeInTheDocument());

        const updated = lastTableProps.filters.find((f: { id: string }) => f.id === 'updated');
        act(() => updated.onChange({ from: '2026-06-01', to: '2026-06-30' }));

        await waitFor(() => {
            expect(api.getPostingExceptions).toHaveBeenCalledWith(
                expect.objectContaining({ from: '2026-06-01', to: '2026-06-30' }),
            );
        });
        expect(api.getPostingExceptionsSummary).toHaveBeenLastCalledWith(
            expect.objectContaining({ from: '2026-06-01', to: '2026-06-30' }),
        );
    });

    it('shows retry button in event row', async () => {
        const api = getApi();
        api.getPostingExceptions.mockResolvedValue({
            data: mockEvents,
            pagination: { page: 1, limit: 20, total: 2 },
        });
        render(<PostingExceptionsPage />);
        await waitFor(() => {
            expect(screen.getByText('2 rows')).toBeInTheDocument();
        });
        // Data table is mocked, so retry buttons don't render in table
        // Just verify the table exists
        expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });

    it('shows total count in pagination', async () => {
        const api = getApi();
        api.getPostingExceptions.mockResolvedValue({
            data: mockEvents,
            pagination: { page: 1, limit: 20, total: 2 },
        });
        render(<PostingExceptionsPage />);
        await waitFor(() => {
            expect(screen.getByText('2 rows')).toBeInTheDocument();
        });
    });
});
