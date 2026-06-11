'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ReturnsPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/returns',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('../../../lib/api', () => ({
    api: {
        getReturns: jest.fn(),
        deleteReturn: jest.fn(),
        createReturn: jest.fn(),
    },
}));

jest.mock('../../../lib/format', () => ({
    formatBDT: (v: number) => `BDT ${v}`,
    formatDate: (v: string) => `DATE:${v}`,
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ data, isLoading, emptyMessage, toolbarActions }: any) => (
        <div data-testid="data-table">
            {isLoading && <span>Loading...</span>}
            {!isLoading && data.length === 0 && <span>{emptyMessage || 'No data'}</span>}
            {!isLoading && data.map((row: any) => (
                <div key={row.id} data-testid={`row-${row.id}`}>
                    <span>{row.return_number}</span>
                    {row.status && <span>{row.status}</span>}
                    {row.sale && <span>{row.sale.serial_number}</span>}
                </div>
            ))}
            {toolbarActions && <div data-testid="toolbar">{toolbarActions}</div>}
        </div>
    ),
}));

jest.mock('./IssueReturnModal', () => ({
    __esModule: true,
    default: ({ isOpen, onClose, onCreated }: any) =>
        isOpen ? (
            <div data-testid="issue-modal">
                <button onClick={onClose}>Close Modal</button>
                <button onClick={() => onCreated({
                    id: 'ret-new',
                    return_number: 'RET-NEW',
                    status: 'COMPLETED',
                    total_refund: '200',
                    items: [],
                    created_at: new Date().toISOString(),
                })}>
                    Issue Return
                </button>
            </div>
        ) : null,
}));

jest.mock('@/components/PostingBadge', () => ({
    PostingBadge: ({ status }: any) => <span data-testid="posting-badge">{status}</span>,
}));

const mockReturns = [
    {
        id: 'ret-1',
        return_number: 'RET-00001',
        status: 'COMPLETED',
        total_refund: '750',
        reason: 'Defective item',
        created_at: '2026-01-10T10:00:00Z',
        items: [{ id: 'ri-1' }],
        sale: { serial_number: 'SALE-001' },
        posting_status: null,
        voucher_number: null,
    },
    {
        id: 'ret-2',
        return_number: 'RET-00002',
        status: 'PENDING',
        total_refund: '300',
        reason: null,
        created_at: '2026-01-11T10:00:00Z',
        items: [],
        sale: { serial_number: 'SALE-002' },
        posting_status: 'POSTED',
        voucher_number: 'VOU-001',
    },
];

describe('ReturnsPage', () => {
    beforeEach(() => {
        window.alert = jest.fn();
        window.confirm = jest.fn(() => true);

        const { api } = require('../../../lib/api');
        api.getReturns.mockResolvedValue(mockReturns);
        api.deleteReturn.mockResolvedValue({ deleted: true });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('shows loading state initially', () => {
        const { api } = require('../../../lib/api');
        api.getReturns.mockReturnValue(new Promise(() => {}));
        render(<ReturnsPage />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renders return rows after loading', async () => {
        render(<ReturnsPage />);
        await waitFor(() => {
            expect(screen.getByText('RET-00001')).toBeInTheDocument();
            expect(screen.getByText('RET-00002')).toBeInTheDocument();
        });
    });

    it('renders return statuses', async () => {
        render(<ReturnsPage />);
        await waitFor(() => {
            expect(screen.getByText('COMPLETED')).toBeInTheDocument();
            expect(screen.getByText('PENDING')).toBeInTheDocument();
        });
    });

    it('renders sale serial numbers', async () => {
        render(<ReturnsPage />);
        await waitFor(() => {
            expect(screen.getByText('SALE-001')).toBeInTheDocument();
            expect(screen.getByText('SALE-002')).toBeInTheDocument();
        });
    });

    it('renders DataTable', async () => {
        render(<ReturnsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('shows empty state when no returns', async () => {
        const { api } = require('../../../lib/api');
        api.getReturns.mockResolvedValue([]);
        render(<ReturnsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('renders Issue Return button in toolbar', async () => {
        render(<ReturnsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /issue return/i })).toBeInTheDocument();
        });
    });

    it('opens issue return modal when button is clicked', async () => {
        render(<ReturnsPage />);
        await waitFor(() => screen.getByRole('button', { name: /issue return/i }));
        fireEvent.click(screen.getByRole('button', { name: /issue return/i }));
        expect(screen.getByTestId('issue-modal')).toBeInTheDocument();
    });

    it('closes modal when Close is clicked', async () => {
        render(<ReturnsPage />);
        await waitFor(() => screen.getByRole('button', { name: /issue return/i }));
        fireEvent.click(screen.getByRole('button', { name: /issue return/i }));
        fireEvent.click(screen.getByRole('button', { name: /close modal/i }));
        expect(screen.queryByTestId('issue-modal')).not.toBeInTheDocument();
    });

    it('adds new return to list when created via modal', async () => {
        render(<ReturnsPage />);
        await waitFor(() => screen.getByRole('button', { name: /issue return/i }));
        fireEvent.click(screen.getByRole('button', { name: /issue return/i }));
        fireEvent.click(screen.getByRole('button', { name: /issue return/i, hidden: true }) || screen.getByText('Issue Return'));
        await waitFor(() => {
            expect(screen.getByText('RET-NEW')).toBeInTheDocument();
        });
    });

    it('calls getReturns on mount', async () => {
        const { api } = require('../../../lib/api');
        render(<ReturnsPage />);
        await waitFor(() => {
            expect(api.getReturns).toHaveBeenCalledTimes(1);
        });
    });

    it('handles API error gracefully', async () => {
        const { api } = require('../../../lib/api');
        api.getReturns.mockRejectedValue(new Error('Server error'));
        render(<ReturnsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });
});
