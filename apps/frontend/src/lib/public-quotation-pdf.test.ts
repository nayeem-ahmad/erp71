/**
 * Tests for the downloadable PDF of a shared quotation.
 *
 * jsPDF is mocked rather than exercised: what matters here is that the file is
 * drawn from the tenant's own letterhead and that the numbers on it are the
 * numbers the page shows — not that jsPDF can draw a rectangle. Asserting on
 * the drawing calls also pins the two decisions that are easy to undo by
 * accident: money carries an ISO code rather than `৳` (which jsPDF's built-in
 * fonts cannot draw), and a logo that will not load is skipped instead of
 * taking the download down with it.
 */
import { downloadQuotationPdf, type QuotationPdfData } from './public-quotation-pdf';

const mockDoc = {
    text: jest.fn(),
    setFont: jest.fn(),
    setFontSize: jest.fn(),
    setTextColor: jest.fn(),
    setDrawColor: jest.fn(),
    setLineWidth: jest.fn(),
    line: jest.fn(),
    addImage: jest.fn(),
    addPage: jest.fn(),
    save: jest.fn(),
    splitTextToSize: jest.fn((value: string) => [value]),
    lastAutoTable: { finalY: 120 },
};
const mockAutoTable = jest.fn();

jest.mock('jspdf', () => ({ __esModule: true, default: jest.fn(() => mockDoc) }));
jest.mock('jspdf-autotable', () => ({ __esModule: true, default: (...args: unknown[]) => mockAutoTable(...args) }));

/** Every string the document draws, in order, so assertions can just look. */
const drawnText = () => mockDoc.text.mock.calls.map((call) => String(call[0]));

const data = (overrides: Partial<QuotationPdfData> = {}): QuotationPdfData => ({
    title: 'Quotation',
    documentNumber: 'Q-1001',
    issuedOn: '01/08/2026',
    validUntil: '01/09/2026',
    customerName: 'Rahim Traders',
    currency: 'BDT',
    items: [{ product_name: 'Ceiling Fan', quantity: 3, unit_price: 5000, line_total: 15000 }],
    totalLabel: 'Total',
    total: 15000,
    labels: {
        preparedFor: 'Prepared for',
        issued: 'Issued',
        validUntil: 'Valid until',
        item: 'Item',
        quantity: 'Qty',
        unitPrice: 'Unit price',
        lineTotal: 'Total',
        terms: 'Terms',
        remitTo: 'Remit to',
        notes: 'Notes',
    },
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockDoc.lastAutoTable = { finalY: 120 };
});

describe('downloadQuotationPdf', () => {
    it('saves the file under the document number', async () => {
        await downloadQuotationPdf(data());
        expect(mockDoc.save).toHaveBeenCalledWith('Q-1001.pdf');
    });

    it('draws the tenant letterhead, tokens resolved', async () => {
        await downloadQuotationPdf(
            data({
                letterhead: {
                    config: { lines: [{ text: '{{address}}' }, { text: 'Tel: {{phone}}' }] },
                    context: { companyName: 'Rahim Electricals', address: '12 Motijheel C/A' },
                },
            }),
        );

        const drawn = drawnText();
        expect(drawn).toContain('Rahim Electricals');
        expect(drawn).toContain('12 Motijheel C/A');
        // A line whose only token resolves empty is dropped rather than printed
        // as a bare "Tel:" — the same rule the HTML renderer applies.
        expect(drawn.some((entry) => entry.startsWith('Tel:'))).toBe(false);
    });

    it('prints the document title the way the template asks for it', async () => {
        await downloadQuotationPdf(
            data({ letterhead: { config: { title: { uppercase: true } }, context: {} } }),
        );
        expect(drawnText()).toContain('QUOTATION');
    });

    it('carries the money as an ISO code, never as a currency symbol', async () => {
        await downloadQuotationPdf(data({ currency: 'USD', total: 1200 }));

        expect(mockAutoTable).toHaveBeenCalledWith(
            mockDoc,
            expect.objectContaining({
                body: [['Ceiling Fan', '3', 'USD 5,000.00', 'USD 15,000.00']],
            }),
        );
        expect(drawnText()).toContain('USD 1,200.00');
        expect(drawnText().join(' ')).not.toContain('৳');
    });

    it('renders the advance, terms, bank details and notes', async () => {
        await downloadQuotationPdf(
            data({
                advance: { label: 'Advance due (30%)', amount: 4500 },
                terms: [{ label: 'Incoterm', value: 'FOB' }],
                bank: [{ label: 'SWIFT', value: 'CIBLBDDH' }],
                notes: 'Delivery within 7 days',
            }),
        );

        const drawn = drawnText();
        expect(drawn).toContain('Advance due (30%)');
        expect(drawn).toContain('BDT 4,500.00');
        expect(drawn).toContain('TERMS');
        expect(drawn).toContain('FOB');
        expect(drawn).toContain('REMIT TO');
        expect(drawn).toContain('CIBLBDDH');
        expect(drawn).toContain('Delivery within 7 days');
    });

    it('prints the tenant footer when the template designs one', async () => {
        await downloadQuotationPdf(
            data({
                letterhead: {
                    config: { footer: { show: true, lines: [{ text: 'Thank you for your business.' }] } },
                    context: {},
                },
            }),
        );
        expect(drawnText()).toContain('Thank you for your business.');
    });

    it('still produces the file when the logo cannot be fetched', async () => {
        // A host that serves the image without an `Access-Control-Allow-Origin`
        // header, a deleted asset, a dead connection — all of them land here,
        // and none of them may cost the buyer their download.
        class FailingImage {
            crossOrigin = '';
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                queueMicrotask(() => this.onerror?.());
            }
        }
        (global as unknown as { Image: unknown }).Image = FailingImage;

        await downloadQuotationPdf(
            data({
                letterhead: {
                    config: { logo: { url: 'https://cdn.example.com/logo.png' } },
                    context: { companyName: 'Rahim Electricals' },
                },
            }),
        );

        expect(mockDoc.addImage).not.toHaveBeenCalled();
        expect(mockDoc.save).toHaveBeenCalledWith('Q-1001.pdf');
        expect(drawnText()).toContain('Rahim Electricals');
    });

    it('places the logo when it loads', async () => {
        class LoadingImage {
            crossOrigin = '';
            naturalWidth = 200;
            naturalHeight = 100;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        (global as unknown as { Image: unknown }).Image = LoadingImage;
        HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ drawImage: jest.fn() })) as never;
        HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,AAAA');

        await downloadQuotationPdf(
            data({
                letterhead: {
                    config: { logo: { url: 'https://cdn.example.com/logo.png', heightMm: 16 } },
                    context: {},
                },
            }),
        );

        // 2:1 source at 16mm tall is 32mm wide — the aspect ratio survives.
        expect(mockDoc.addImage).toHaveBeenCalledWith(
            'data:image/png;base64,AAAA',
            'PNG',
            expect.any(Number),
            expect.any(Number),
            32,
            16,
        );
    });
});
