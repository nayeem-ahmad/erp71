import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import InventoryTransferDetailPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/inventory/transfers/t1',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({ id: 't1' }),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, className }: any) => (
        <a href={href} className={className}>{children}</a>
    ),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getWarehouseTransfer: jest.fn(),
        sendWarehouseTransfer: jest.fn(),
        approveWarehouseTransfer: jest.fn(),
        rejectWarehouseTransfer: jest.fn(),
        receiveWarehouseTransfer: jest.fn(),
    },
}));

import { api } from '@/lib/api';
const mockApi = api as jest.Mocked<typeof api>;

/** A cross-branch transfer in whatever state the case under test needs. */
function transfer(overrides: Record<string, unknown> = {}) {
    return {
        id: 't1',
        transfer_number: 'TRF-00001',
        status: 'PENDING_APPROVAL',
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T10:30:00Z',
        sent_at: null,
        received_at: null,
        is_cross_branch: true,
        requires_approval: true,
        approved_by: null,
        approval_date: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        sourceWarehouse: { id: 'w1', name: 'Main Warehouse', store_id: 's1' },
        destinationWarehouse: { id: 'w2', name: 'Branch Warehouse', store_id: 's2' },
        items: [
            { id: 'i1', product_id: 'p1', quantity_sent: 10, quantity_received: 0, note: null, product: { name: 'Widget A' } },
        ],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getWarehouseTransfer.mockResolvedValue(transfer());
});

async function renderPage() {
    render(<InventoryTransferDetailPage />);
    await waitFor(() => expect(screen.getByText('Transfer Lines')).toBeInTheDocument());
}

describe('InventoryTransferDetailPage — cross-branch approval', () => {
    it('says the stock has not moved while the transfer waits for approval', async () => {
        await renderPage();

        expect(screen.getByText(/still at the source branch/)).toBeInTheDocument();
    });

    it('offers approve and reject, and not receive, while awaiting approval', async () => {
        await renderPage();

        expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Reject/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Receive Stock/ })).not.toBeInTheDocument();
    });

    it('approves through the API and reloads the transfer', async () => {
        mockApi.approveWarehouseTransfer.mockResolvedValue({});
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
        });

        expect(mockApi.approveWarehouseTransfer).toHaveBeenCalledWith('t1');
        expect(mockApi.getWarehouseTransfer).toHaveBeenCalledTimes(2);
        expect(screen.getByText(/stock has left the source warehouse/)).toBeInTheDocument();
    });

    it('asks for a reason before rejecting, and sends it trimmed', async () => {
        mockApi.rejectWarehouseTransfer.mockResolvedValue({});
        await renderPage();

        // The reason field is revealed by Reject, not shown up front.
        expect(screen.queryByLabelText('Reason for rejection')).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Reject/ }));
        });
        const reason = screen.getByLabelText('Reason for rejection');
        await act(async () => {
            fireEvent.change(reason, { target: { value: '  keeping it for our own sales  ' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm Rejection' }));
        });

        expect(mockApi.rejectWarehouseTransfer).toHaveBeenCalledWith('t1', {
            reason: 'keeping it for our own sales',
        });
    });

    it('sends no reason at all when the approver typed only spaces', async () => {
        mockApi.rejectWarehouseTransfer.mockResolvedValue({});
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Reject/ }));
        });
        await act(async () => {
            fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: '   ' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm Rejection' }));
        });

        expect(mockApi.rejectWarehouseTransfer).toHaveBeenCalledWith('t1', { reason: undefined });
    });

    it('surfaces the approver’s reason on a rejected transfer', async () => {
        mockApi.getWarehouseTransfer.mockResolvedValue(transfer({
            status: 'REJECTED',
            rejected_by: 'u2',
            rejected_at: '2024-01-02T09:00:00Z',
            rejection_reason: 'keeping it for our own sales',
        }));
        await renderPage();

        expect(screen.getByText(/keeping it for our own sales/)).toBeInTheDocument();
        expect(screen.getByText(/no stock moved/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    });

    it('labels a draft that needs approval as a submission, not a send', async () => {
        mockApi.getWarehouseTransfer.mockResolvedValue(transfer({ status: 'DRAFT' }));
        await renderPage();

        expect(screen.getByRole('button', { name: /Submit for Approval/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Send Transfer/ })).not.toBeInTheDocument();
    });

    it('still calls a same-branch draft a send', async () => {
        mockApi.getWarehouseTransfer.mockResolvedValue(transfer({
            status: 'DRAFT',
            is_cross_branch: false,
            requires_approval: false,
            destinationWarehouse: { id: 'w4', name: 'Overflow Warehouse', store_id: 's1' },
        }));
        await renderPage();

        expect(screen.getByRole('button', { name: /Send Transfer/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Submit for Approval/ })).not.toBeInTheDocument();
    });

    it('records the scope in the audit snapshot', async () => {
        await renderPage();

        expect(screen.getByText(/Scope:/)).toBeInTheDocument();
        expect(screen.getByText(/Between branches/)).toBeInTheDocument();
    });

    it('reports a failed approval instead of claiming success', async () => {
        mockApi.approveWarehouseTransfer.mockRejectedValue(new Error('Missing store permissions: APPROVE_GOODS_TRANSFER'));
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
        });

        expect(screen.getByText(/Missing store permissions/)).toBeInTheDocument();
        expect(screen.queryByText(/stock has left the source warehouse/)).not.toBeInTheDocument();
    });
});
