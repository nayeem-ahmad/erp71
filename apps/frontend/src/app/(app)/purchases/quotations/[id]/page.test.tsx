import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    useParams: jest.fn(() => ({ id: 'rfq-1' })),
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    usePathname: jest.fn(() => '/test'),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getPurchaseQuotation: jest.fn(),
        updatePurchaseQuotationStatus: jest.fn(),
        convertPurchaseQuotation: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (val: number) => `৳${val.toFixed(2)}`,
    formatDate: (val: string) => val,
}));

import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const mockRfqDraft = {
    id: 'rfq-1',
    rfq_number: 'RFQ-0001',
    status: 'DRAFT',
    valid_until: '2024-12-31',
    created_at: '2024-06-01T10:00:00Z',
    notes: null,
    total_amount: '1500.00',
    supplier: {
        id: 'sup-1',
        name: 'ABC Supplies',
        phone: '01711234567',
        email: 'abc@supplies.com',
    },
    store: { name: 'Main Store' },
    items: [
        {
            id: 'item-1',
            quantity: 10,
            unit_cost: '100.00',
            line_total: '1000.00',
            product: { id: 'prod-1', name: 'Rice 5kg', sku: 'R5KG' },
        },
        {
            id: 'item-2',
            quantity: 5,
            unit_cost: '100.00',
            line_total: '500.00',
            product: { id: 'prod-2', name: 'Oil 1L', sku: null },
        },
    ],
};

const mockRfqAccepted = {
    ...mockRfqDraft,
    status: 'ACCEPTED',
    notes: 'Good price',
};

const mockRfqConverted = {
    ...mockRfqDraft,
    status: 'CONVERTED',
};

const mockRfqReceived = {
    ...mockRfqDraft,
    status: 'RECEIVED',
};

const mockRfqNoSupplier = {
    ...mockRfqDraft,
    supplier: null,
    store: null,
    valid_until: null,
};

describe('PurchaseQuotationDetailPage', () => {
    const mockPush = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
        (useParams as jest.Mock).mockReturnValue({ id: 'rfq-1' });
    });

    it('shows loading state initially', async () => {
        let resolve: (val: any) => void;
        const pending = new Promise((res) => { resolve = res; });
        (api.getPurchaseQuotation as jest.Mock).mockReturnValue(pending);

        render(React.createElement(require('./page').default));

        expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    });

    it('renders RFQ number and details after loading', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqDraft);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getAllByText('RFQ-0001').length).toBeGreaterThan(0));

        expect(screen.getByText('DRAFT')).toBeInTheDocument();
        expect(screen.getByText('ABC Supplies')).toBeInTheDocument();
        expect(screen.getByText('01711234567')).toBeInTheDocument();
        expect(screen.getByText('abc@supplies.com')).toBeInTheDocument();
        expect(screen.getByText('Main Store')).toBeInTheDocument();
    });

    it('renders line items table', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqDraft);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('Rice 5kg')).toBeInTheDocument());
        expect(screen.getByText('Oil 1L')).toBeInTheDocument();
        expect(screen.getByText('R5KG')).toBeInTheDocument();
        // null SKU shows as em dash
        const dashCells = screen.getAllByText('—');
        expect(dashCells.length).toBeGreaterThan(0);
    });

    it('shows error message when load fails', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockRejectedValue(new Error('Network error'));

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() =>
            expect(screen.getByText(/Failed to load purchase quotation/i)).toBeInTheDocument()
        );
    });

    it('does not render when params.id is absent', async () => {
        (useParams as jest.Mock).mockReturnValue({});
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqDraft);

        render(React.createElement(require('./page').default));

        expect(api.getPurchaseQuotation).not.toHaveBeenCalled();
    });

    it('navigates back on Back button click', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqDraft);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getAllByText('RFQ-0001').length).toBeGreaterThan(0));

        const backLink = screen.getByText('Purchase Quotations (RFQ)').closest('a');
        expect(backLink).toHaveAttribute('href', '/purchases/quotations');
    });

    it('shows DRAFT action buttons: Mark as Sent and Cancel RFQ', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqDraft);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('Mark as Sent')).toBeInTheDocument());
        expect(screen.getByText('Cancel RFQ')).toBeInTheDocument();
    });

    it('calls updatePurchaseQuotationStatus when action button is clicked', async () => {
        const updatedRfq = { ...mockRfqDraft, status: 'SENT' };
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqDraft);
        (api.updatePurchaseQuotationStatus as jest.Mock).mockResolvedValue(updatedRfq);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('Mark as Sent')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByText('Mark as Sent'));
        });

        await waitFor(() =>
            expect(api.updatePurchaseQuotationStatus).toHaveBeenCalledWith('rfq-1', 'SENT')
        );
    });

    it('shows error when status update fails', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqDraft);
        (api.updatePurchaseQuotationStatus as jest.Mock).mockRejectedValue(new Error('Update failed'));

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('Mark as Sent')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByText('Mark as Sent'));
        });

        await waitFor(() => expect(screen.getByText('Update failed')).toBeInTheDocument());
    });

    it('shows Convert to Purchase Order button when status is ACCEPTED', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqAccepted);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() =>
            expect(screen.getAllByText(/Convert to Purchase Order/i).length).toBeGreaterThan(0)
        );
        expect(screen.getByText(/Quote accepted\./i)).toBeInTheDocument();
    });

    it('converts RFQ to PO and navigates on confirm', async () => {
        const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
        const mockAlert = jest.spyOn(window, 'alert').mockImplementation(() => {});
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqAccepted);
        (api.convertPurchaseQuotation as jest.Mock).mockResolvedValue({
            id: 'po-1',
            po_number: 'PO-0001',
        });

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() =>
            expect(screen.getAllByText(/Convert to Purchase Order/i).length).toBeGreaterThan(0)
        );

        // Click the header button (the first one)
        await act(async () => {
            fireEvent.click(screen.getAllByText(/Convert to Purchase Order/i)[0]);
        });

        await waitFor(() => {
            expect(api.convertPurchaseQuotation).toHaveBeenCalledWith('rfq-1');
            expect(mockAlert).toHaveBeenCalledWith('Created Purchase Order PO-0001');
            expect(mockPush).toHaveBeenCalledWith('/purchases/orders/po-1');
        });

        mockConfirm.mockRestore();
        mockAlert.mockRestore();
    });

    it('does not convert when user cancels confirm dialog', async () => {
        const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqAccepted);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() =>
            expect(screen.getAllByText(/Convert to Purchase Order/i).length).toBeGreaterThan(0)
        );

        await act(async () => {
            fireEvent.click(screen.getAllByText(/Convert to Purchase Order/i)[0]);
        });

        expect(api.convertPurchaseQuotation).not.toHaveBeenCalled();
        mockConfirm.mockRestore();
    });

    it('shows error when conversion fails', async () => {
        const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqAccepted);
        (api.convertPurchaseQuotation as jest.Mock).mockRejectedValue(new Error('Conversion failed'));

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() =>
            expect(screen.getAllByText(/Convert to Purchase Order/i).length).toBeGreaterThan(0)
        );

        await act(async () => {
            fireEvent.click(screen.getAllByText(/Convert to Purchase Order/i)[0]);
        });

        await waitFor(() => expect(screen.getByText('Conversion failed')).toBeInTheDocument());
        mockConfirm.mockRestore();
    });

    it('shows CONVERTED status banner and navigates to purchase orders', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqConverted);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('CONVERTED')).toBeInTheDocument());

        const viewPOLink = screen.getByText(/View Purchase Orders →/i);
        fireEvent.click(viewPOLink);
        expect(mockPush).toHaveBeenCalledWith('/purchases/orders');
    });

    it('shows RECEIVED status actions and accept/reject hint', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqReceived);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('Accept Quote')).toBeInTheDocument());
        expect(screen.getByText('Reject Quote')).toBeInTheDocument();
        expect(screen.getByText(/Accept the quote to enable/i)).toBeInTheDocument();
    });

    it('shows notes when present', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqAccepted);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('Good price')).toBeInTheDocument());
    });

    it('shows No supplier linked when supplier is null', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqNoSupplier);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText(/No supplier linked/i)).toBeInTheDocument());
        // Store should show em dash
        const dashes = screen.getAllByText('—');
        expect(dashes.length).toBeGreaterThan(0);
    });

    it('shows valid_until in header when present', async () => {
        (api.getPurchaseQuotation as jest.Mock).mockResolvedValue(mockRfqDraft);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText(/Valid until/i)).toBeInTheDocument());
    });
});
