'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PostingRulesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getPostingRules: jest.fn(),
        getAccounts: jest.fn(),
        updatePostingRule: jest.fn(),
    },
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ title, data, isLoading, filterLayout, viewOptions, filters, stats }: any) => (
        <div data-testid="data-table" data-filter-layout={filterLayout} data-view-options={String(Boolean(viewOptions))}>
            <div>{title}</div>
            {isLoading && <div>Loading table</div>}
            <span data-testid="filter-ids">{(filters ?? []).map((f: any) => f.id).join(',')}</span>
            <button type="button" onClick={() => filters?.find((f: any) => f.id === 'event')?.onChange(['sale'])}>
                Sale only
            </button>
            <button type="button" onClick={() => filters?.find((f: any) => f.id === 'status')?.onChange(['active'])}>
                Active only
            </button>
            {(stats?.items ?? []).map((stat: any) => (
                <span key={stat.id} data-testid={`stat-${stat.id}`}>{stat.value}</span>
            ))}
            {data && data.map((item: any, i: number) => (
                <div key={i} data-testid={`rule-row-${i}`}>
                    <span>{item.eventType}</span>
                </div>
            ))}
        </div>
    ),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/accounting/posting-rules',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

const mockAccounts = [
    { id: 'acc1', name: 'Cash', code: '1010' },
    { id: 'acc2', name: 'Revenue', code: '4000' },
    { id: 'acc3', name: 'COGS', code: '5000' },
];

const mockRules = [
    {
        id: 'rule1',
        eventType: 'sale',
        conditionKey: 'none',
        conditionValue: null,
        debitAccount: { id: 'acc1', name: 'Cash', code: '1010' },
        creditAccount: { id: 'acc2', name: 'Revenue', code: '4000' },
        priority: 100,
        isActive: true,
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'rule2',
        eventType: 'purchase',
        conditionKey: 'payment_mode',
        conditionValue: 'cash',
        debitAccount: { id: 'acc3', name: 'COGS', code: '5000' },
        creditAccount: { id: 'acc1', name: 'Cash', code: '1010' },
        priority: 200,
        isActive: false,
        updatedAt: '2024-01-02T00:00:00Z',
    },
];

describe('PostingRulesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getPostingRules.mockResolvedValue({ data: [] });
        api.getAccounts.mockResolvedValue([]);
        api.updatePostingRule.mockResolvedValue({});
    });

    it('renders the page heading', async () => {
        render(<PostingRulesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Posting Rules').length).toBeGreaterThan(0);
        });
    });

    it('shows loading state while fetching', () => {
        const { api } = require('@/lib/api');
        api.getPostingRules.mockReturnValue(new Promise(() => {}));
        api.getAccounts.mockReturnValue(new Promise(() => {}));

        render(<PostingRulesPage />);
        expect(screen.getByText('Loading table')).toBeInTheDocument();
    });

    it('loads and displays posting rules from the API', async () => {
        const { api } = require('@/lib/api');
        api.getPostingRules.mockResolvedValue({ data: mockRules });
        api.getAccounts.mockResolvedValue(mockAccounts);

        render(<PostingRulesPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading table')).not.toBeInTheDocument();
        });
        expect(api.getPostingRules).toHaveBeenCalledTimes(1);
        expect(api.getAccounts).toHaveBeenCalledTimes(1);
    });

    it('puts the filters in the toolbar row as chips', async () => {
        render(<PostingRulesPage />);
        const table = await screen.findByTestId('data-table');
        expect(table).toHaveAttribute('data-filter-layout', 'row');
        expect(table).toHaveAttribute('data-view-options', 'true');
        expect(screen.getByTestId('filter-ids')).toHaveTextContent(
            'event,status,condition,debitAccount,creditAccount,priority',
        );
        // The old select row is gone.
        expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    });

    it('narrows rules by event type from the chip, and the strip follows', async () => {
        const { api } = require('@/lib/api');
        api.getPostingRules.mockResolvedValue({ data: mockRules });
        api.getAccounts.mockResolvedValue(mockAccounts);

        render(<PostingRulesPage />);
        await waitFor(() => expect(screen.getByTestId('rule-row-1')).toBeInTheDocument());
        expect(screen.getByTestId('stat-rules')).toHaveTextContent('2');

        fireEvent.click(screen.getByRole('button', { name: 'Sale only' }));

        await waitFor(() => expect(screen.queryByTestId('rule-row-1')).not.toBeInTheDocument());
        expect(screen.getByTestId('rule-row-0')).toHaveTextContent('sale');
        expect(screen.getByTestId('stat-rules')).toHaveTextContent('1');
        expect(screen.getByTestId('stat-active')).toHaveTextContent('1');
    });

    it('narrows rules by status from the chip', async () => {
        const { api } = require('@/lib/api');
        api.getPostingRules.mockResolvedValue({ data: mockRules });
        api.getAccounts.mockResolvedValue(mockAccounts);

        render(<PostingRulesPage />);
        await waitFor(() => expect(screen.getByTestId('rule-row-1')).toBeInTheDocument());
        expect(screen.getByTestId('stat-inactive')).toHaveTextContent('1');
        expect(screen.getByTestId('stat-conditional')).toHaveTextContent('1');

        fireEvent.click(screen.getByRole('button', { name: 'Active only' }));

        await waitFor(() => expect(screen.queryByTestId('rule-row-1')).not.toBeInTheDocument());
        expect(screen.getByTestId('stat-inactive')).toHaveTextContent('0');
    });

    it('renders the breadcrumb back to Accounting', async () => {
        render(<PostingRulesPage />);
        await waitFor(() => {
            expect(screen.getByText(/Accounting/)).toBeInTheDocument();
        });
        const link = screen.getByRole('link', { name: /accounting/i });
        expect(link).toHaveAttribute('href', '/accounting');
    });

    it('shows the DataTable once loading completes', async () => {
        const { api } = require('@/lib/api');
        api.getPostingRules.mockResolvedValue({ data: mockRules });
        api.getAccounts.mockResolvedValue(mockAccounts);

        render(<PostingRulesPage />);
        await waitFor(() => {
            expect(screen.queryByText('Loading table')).not.toBeInTheDocument();
            expect(screen.getAllByText('Posting Rules').length).toBeGreaterThan(0);
        });
    });

    it('logs error to console when API fails', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { api } = require('@/lib/api');
        api.getPostingRules.mockRejectedValue(new Error('Network error'));

        render(<PostingRulesPage />);
        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Failed to load posting rules', expect.any(Error));
        });
        consoleSpy.mockRestore();
    });

    it('handles empty posting rules data gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getPostingRules.mockResolvedValue({ data: undefined });
        api.getAccounts.mockResolvedValue([]);

        render(<PostingRulesPage />);
        await waitFor(() => {
            expect(screen.queryByText('Loading table')).not.toBeInTheDocument();
        });
        // Should not crash and should render the table with empty data
        expect(screen.getAllByText('Posting Rules').length).toBeGreaterThan(0);
    });
});
