/**
 * Tests for the shared-quotation page body.
 *
 * The three things a seller is promised when they send a link: the document
 * carries their letterhead, it prints, and it downloads as a file. Each is
 * asserted here, along with the fallbacks — a payload with no letterhead still
 * renders a header, and a download that fails says so instead of doing nothing.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PublicQuotationView, { type PublicQuotation } from './PublicQuotationView';

const downloadQuotationPdf = jest.fn();
jest.mock('@/lib/public-quotation-pdf', () => ({
    downloadQuotationPdf: (...args: unknown[]) => downloadQuotationPdf(...args),
}));

const quotation = (overrides: Partial<PublicQuotation> = {}): PublicQuotation => ({
    quote_number: 'Q-1001',
    version: 1,
    status: 'SENT',
    created_at: '2026-08-01T00:00:00.000Z',
    valid_until: '2026-09-01T00:00:00.000Z',
    customer_name: 'Rahim Traders',
    seller_name: 'Main Branch',
    notes: null,
    items: [{ product_name: 'Ceiling Fan', quantity: 3, unit_price: 5000, line_total: 15000 }],
    total_amount: 15000,
    doc_kind: 'QUOTE',
    currency: 'BDT',
    incoterm: null,
    port_of_loading: null,
    port_of_discharge: null,
    payment_terms: null,
    advance_percent: null,
    advance_amount: null,
    delivery_lead_time_days: null,
    country_of_origin: null,
    beneficiary_bank: null,
    letterhead: {
        config: {
            company: { nameOverride: 'Rahim Electricals' },
            lines: [{ text: '{{address}}' }],
        },
        context: { company_name: 'Rahim Electricals', address: '12 Motijheel C/A' },
    },
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    downloadQuotationPdf.mockResolvedValue(undefined);
});

describe('PublicQuotationView', () => {
    it('renders the tenant letterhead, tokens resolved', () => {
        const { container } = render(<PublicQuotationView quotation={quotation()} />);

        const band = container.querySelector('.p71-hd');
        expect(band).not.toBeNull();
        expect(band!.textContent).toContain('Rahim Electricals');
        expect(band!.textContent).toContain('12 Motijheel C/A');
        // The letterhead's own document block names the paper. Upper-casing
        // is the template's `text-transform`, so the text itself stays cased.
        expect(band!.textContent).toContain('Quotation');
        expect(band!.textContent).toContain('Q-1001');
    });

    it('renders the tenant footer band when the template designs one', () => {
        const { container } = render(
            <PublicQuotationView
                quotation={quotation({
                    letterhead: {
                        config: { footer: { show: true, lines: [{ text: 'Thank you for your business.' }] } },
                        context: {},
                    },
                })}
            />,
        );

        expect(container.querySelector('.p71-ft')?.textContent).toContain('Thank you for your business.');
    });

    it('falls back to a plain seller header when no letterhead could be resolved', () => {
        const { container } = render(<PublicQuotationView quotation={quotation({ letterhead: null })} />);

        expect(container.querySelector('.p71-hd')).toBeNull();
        // The seller's name is still the top of their own document.
        expect(screen.getAllByText('Main Branch').length).toBeGreaterThan(0);
        expect(screen.getByText('Ceiling Fan')).toBeInTheDocument();
    });

    it('prints through the browser', () => {
        const print = jest.fn();
        Object.defineProperty(window, 'print', { value: print, writable: true });

        render(<PublicQuotationView quotation={quotation()} />);
        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        expect(print).toHaveBeenCalled();
    });

    it('downloads a PDF carrying the letterhead and the document', async () => {
        render(<PublicQuotationView quotation={quotation({ doc_kind: 'PROFORMA', currency: 'USD', incoterm: 'FOB' })} />);
        fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));

        await waitFor(() => expect(downloadQuotationPdf).toHaveBeenCalled());
        expect(downloadQuotationPdf).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Proforma Invoice',
                documentNumber: 'Q-1001',
                currency: 'USD',
                total: 15000,
                items: [{ product_name: 'Ceiling Fan', quantity: 3, unit_price: 5000, line_total: 15000 }],
                terms: [{ label: 'Incoterm', value: 'FOB' }],
                letterhead: expect.objectContaining({
                    context: expect.objectContaining({ companyName: 'Rahim Electricals' }),
                }),
            }),
        );
    });

    it('numbers a revision the same way on screen and in the file', async () => {
        render(<PublicQuotationView quotation={quotation({ version: 3 })} />);
        fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));

        await waitFor(() => expect(downloadQuotationPdf).toHaveBeenCalled());
        expect(downloadQuotationPdf).toHaveBeenCalledWith(
            expect.objectContaining({ documentNumber: 'Q-1001 (v3)' }),
        );
    });

    it('says so when the PDF cannot be prepared, and leaves Print working', async () => {
        downloadQuotationPdf.mockRejectedValue(new Error('boom'));

        render(<PublicQuotationView quotation={quotation()} />);
        fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/Print/);
        expect(screen.getByRole('button', { name: /^print$/i })).toBeEnabled();
    });
});
