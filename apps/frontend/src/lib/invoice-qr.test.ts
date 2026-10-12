import * as QRCode from 'qrcode';
import { invoiceQrDataUrl, invoiceUrl } from './invoice-qr';

jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

describe('invoiceUrl', () => {
    it('is the sale’s own invoice page on this app, and nothing else', () => {
        expect(invoiceUrl('sale-1', 'https://app.erp71.com')).toBe('https://app.erp71.com/sales/sale-1/invoice');
    });
});

describe('invoiceQrDataUrl', () => {
    beforeEach(() => jest.clearAllMocks());

    it('draws a code that opens that page', async () => {
        (QRCode.toDataURL as jest.Mock).mockResolvedValue('data:image/png;base64,QR');

        await expect(invoiceQrDataUrl('sale-1')).resolves.toBe('data:image/png;base64,QR');
        expect(QRCode.toDataURL).toHaveBeenCalledWith(
            `${window.location.origin}/sales/sale-1/invoice`,
            expect.objectContaining({ margin: 1 }),
        );
    });

    it('gives up quietly, so an invoice still prints without its code', async () => {
        (QRCode.toDataURL as jest.Mock).mockRejectedValue(new Error('no canvas'));

        await expect(invoiceQrDataUrl('sale-1')).resolves.toBeUndefined();
    });
});
