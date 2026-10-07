import { DOCUMENT_NUMBER_SOURCES } from './document-number-sources';

describe('DOCUMENT_NUMBER_SOURCES', () => {
    const tx = () => ({
        sale: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        quotation: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        purchase: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    });

    it('counts a sale\'s typed reference as taken, since it prints in place of the invoice number', async () => {
        const client = tx();
        client.sale.findFirst.mockResolvedValueOnce({ id: 'old-sale' });

        await expect(DOCUMENT_NUMBER_SOURCES.SALE.isTaken(client as any, 't1', 'INV-2627-00001')).resolves.toBe(true);
        expect(client.sale.findFirst).toHaveBeenCalledWith({
            where: {
                tenant_id: 't1',
                OR: [{ serial_number: 'INV-2627-00001' }, { reference_number: 'INV-2627-00001' }],
            },
            select: { id: true },
        });
        await expect(DOCUMENT_NUMBER_SOURCES.SALE.isTaken(client as any, 't1', 'INV-2627-00002')).resolves.toBe(false);
    });

    it('lists sales numbers from both columns', async () => {
        const client = tx();
        client.sale.findMany.mockResolvedValue([
            { serial_number: 'INV-2627-00001', reference_number: null },
            { serial_number: 'SL-1755764812345', reference_number: 'INV-2627-00009' },
        ]);

        const numbers = await DOCUMENT_NUMBER_SOURCES.SALE.numbersStartingWith(client as any, 't1', 'INV-2627-');

        expect(numbers).toEqual(expect.arrayContaining(['INV-2627-00001', 'INV-2627-00009']));
    });

    it('checks quotations and proforma invoices against the same column', async () => {
        expect(DOCUMENT_NUMBER_SOURCES.QUOTE).toBe(DOCUMENT_NUMBER_SOURCES.PROFORMA);
        const client = tx();

        await DOCUMENT_NUMBER_SOURCES.PROFORMA.isTaken(client as any, 't1', 'PI-2627-00001');

        // Any kind, any revision: a revision keeps its quote's number.
        expect(client.quotation.findFirst).toHaveBeenCalledWith({
            where: { tenant_id: 't1', quote_number: 'PI-2627-00001' },
            select: { id: true },
        });
    });

    it('checks purchases against our number, never the supplier\'s bill number', async () => {
        const client = tx();

        await DOCUMENT_NUMBER_SOURCES.PURCHASE.isTaken(client as any, 't1', 'PUR-00042');
        await DOCUMENT_NUMBER_SOURCES.PURCHASE.numbersStartingWith(client as any, 't1', 'PUR-');

        expect(client.purchase.findFirst).toHaveBeenCalledWith({
            where: { tenant_id: 't1', purchase_number: 'PUR-00042' },
            select: { id: true },
        });
        expect(client.purchase.findMany).toHaveBeenCalledWith({
            where: { tenant_id: 't1', purchase_number: { startsWith: 'PUR-' } },
            select: { purchase_number: true },
        });
    });
});
