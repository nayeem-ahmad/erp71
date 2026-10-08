import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ConvertToSalesModal, { BULK_CONVERT_LIMIT, type ConvertibleQuote } from './ConvertToSalesModal';

jest.mock('@/lib/api', () => ({
    api: { createSalesFromQuotations: jest.fn() },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

const { api } = jest.requireMock('@/lib/api');
const { toast } = jest.requireMock('@/lib/toast');

const quote = (overrides: Partial<ConvertibleQuote> = {}): ConvertibleQuote => ({
    id: 'q-1',
    quote_number: 'QT-0001',
    status: 'SENT',
    total_amount: '1000',
    currency: 'BDT',
    exchange_rate: null,
    customer_id: 'cust-1',
    customer: { name: 'Alice Corp' },
    items: [{ id: 'i-1' }],
    ...overrides,
});

function renderModal(quotes: ConvertibleQuote[]) {
    const onClose = jest.fn();
    const onConverted = jest.fn();
    render(<ConvertToSalesModal quotes={quotes} onClose={onClose} onConverted={onConverted} />);
    return { onClose, onConverted };
}

beforeEach(() => jest.clearAllMocks());

describe('ConvertToSalesModal — before converting', () => {
    it('counts what can be converted and totals it in BDT, at each proforma\'s own rate', () => {
        renderModal([
            quote(),
            quote({ id: 'q-2', quote_number: 'PI-0001', currency: 'USD', exchange_rate: '120', total_amount: '10' }),
        ]);

        expect(screen.getByText('2 of 2 selected can be converted')).toBeInTheDocument();
        // 1000 + 10 × 120
        expect(screen.getByText(/2,200\.00/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Convert 2/ })).toBeEnabled();
    });

    it('lists what will be skipped, and why, before anything is sent', () => {
        renderModal([
            quote(),
            quote({ id: 'q-2', quote_number: 'QT-0002', status: 'CONVERTED' }),
            quote({ id: 'q-3', quote_number: 'QT-0003', customer_id: null, customer: null }),
        ]);

        const skipped = screen.getByRole('region', { name: 'Will be skipped' });
        expect(within(skipped).getByText('QT-0002')).toBeInTheDocument();
        expect(within(skipped).getByText('Status: Converted')).toBeInTheDocument();
        expect(within(skipped).getByText('No customer — a credit sale needs one')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Convert 1/ })).toBeEnabled();
    });

    it('cannot convert when nothing selected is convertible', () => {
        renderModal([quote({ status: 'REJECTED' })]);

        expect(screen.getByRole('button', { name: /Convert 0/ })).toBeDisabled();
    });

    it('refuses a selection larger than one batch', () => {
        renderModal(Array.from({ length: BULK_CONVERT_LIMIT + 1 }, (_, index) =>
            quote({ id: `q-${index}`, quote_number: `QT-${index}` })));

        expect(screen.getByRole('alert')).toHaveTextContent(`Select at most ${BULK_CONVERT_LIMIT} quotations at a time.`);
        expect(screen.getByRole('button', { name: new RegExp(`Convert ${BULK_CONVERT_LIMIT + 1}`) })).toBeDisabled();
    });
});

describe('ConvertToSalesModal — converting', () => {
    it('sends every selected quotation and reports each outcome', async () => {
        api.createSalesFromQuotations.mockResolvedValue({
            converted: [{ quotationId: 'q-1', quoteNumber: 'QT-0001', saleId: 'sale-1', serialNumber: 'INV-0042', totalAmount: 1000 }],
            skipped: [{ quotationId: 'q-2', quoteNumber: 'QT-0002', reason: 'TOTAL_CHANGED', status: 'SENT' }],
            failed: [{ quotationId: 'q-3', quoteNumber: 'QT-0003', message: 'Credit limit exceeded for this customer.' }],
        });
        const { onConverted } = renderModal([
            quote(),
            quote({ id: 'q-2', quote_number: 'QT-0002' }),
            quote({ id: 'q-3', quote_number: 'QT-0003' }),
        ]);

        fireEvent.click(screen.getByRole('button', { name: /Convert 3/ }));

        await waitFor(() => expect(screen.getByRole('region', { name: 'Converted (1)' })).toBeInTheDocument());
        expect(api.createSalesFromQuotations).toHaveBeenCalledWith(['q-1', 'q-2', 'q-3']);
        expect(screen.getByRole('link', { name: 'INV-0042' })).toHaveAttribute('href', '/sales/sale-1');
        expect(within(screen.getByRole('region', { name: 'Not converted (1)' }))
            .getByText('Credit limit exceeded for this customer.')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Skipped (1)' }))
            .getByText('Its lines no longer add up to the quoted total — convert it on its own')).toBeInTheDocument();
        expect(toast.success).toHaveBeenCalledWith('Quotations converted to sales: 1');
        expect(onConverted).toHaveBeenCalledTimes(1);
    });

    it('does not refresh the list when nothing was converted', async () => {
        api.createSalesFromQuotations.mockResolvedValue({
            converted: [],
            skipped: [{ quotationId: 'q-1', quoteNumber: 'QT-0001', reason: 'ALREADY_INVOICED', status: 'SENT' }],
            failed: [],
        });
        const { onConverted } = renderModal([quote()]);

        fireEvent.click(screen.getByRole('button', { name: /Convert 1/ }));

        await waitFor(() => expect(screen.getByText('No quotations were converted.')).toBeInTheDocument());
        expect(onConverted).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('stays open on a failed request so it can be tried again', async () => {
        api.createSalesFromQuotations.mockRejectedValue(new Error('Network down'));
        renderModal([quote()]);

        fireEvent.click(screen.getByRole('button', { name: /Convert 1/ }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network down'));
        expect(screen.getByRole('button', { name: /Convert 1/ })).toBeEnabled();
    });
});
