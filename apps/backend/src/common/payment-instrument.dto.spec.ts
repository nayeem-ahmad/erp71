import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePurchaseDto } from '../purchases/purchase.dto';
import { CreateSaleDto } from '../sales/sale.dto';

/**
 * The instrument fields only ever arrive nested inside a document's payments,
 * so they are validated the way the global pipe sees them: through the parent
 * body, with `{ whitelist: true, forbidNonWhitelisted: true }` (see main.ts).
 */
describe('PaymentInstrumentDto', () => {
    const CHEQUE = {
        bankName: 'City Bank',
        bankBranch: 'Gulshan',
        bankAccountNumber: '1234567890',
        referenceNo: 'CHQ-889001',
        instrumentDate: '2026-09-25',
    };

    const purchaseBody = (instrument: Record<string, unknown>) => ({
        storeId: 'store-1',
        items: [{ productId: 'prod-1', quantity: 1, unitCost: 100 }],
        payments: [{ paymentMethod: 'Bank', amount: 100, ...instrument }],
    });

    const saleBody = (instrument: Record<string, unknown>) => ({
        storeId: 'store-1',
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 100 }],
        totalAmount: 100,
        amountPaid: 100,
        payments: [{ paymentMethod: 'Bank', amount: 100, ...instrument }],
    });

    const validateBody = (dto: object) => validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    it('lets a purchase payment carry the cheque it was made with', async () => {
        // Until purchases had somewhere to store these, the whitelist refused
        // every one of them as an unknown property.
        const dto = plainToInstance(CreatePurchaseDto, purchaseBody(CHEQUE));

        expect(await validateBody(dto)).toHaveLength(0);
        expect(dto.payments?.[0]).toMatchObject(CHEQUE);
    });

    it('accepts a purchase whose cheque date was typed and then cleared', async () => {
        // An emptied date box sends '' rather than leaving the field out, and
        // `@IsOptional` only waves through null and undefined.
        const dto = plainToInstance(CreatePurchaseDto, purchaseBody({ ...CHEQUE, instrumentDate: '' }));

        expect(await validateBody(dto)).toHaveLength(0);
        expect(dto.payments?.[0].instrumentDate).toBeUndefined();
        expect(dto.payments?.[0].referenceNo).toBe('CHQ-889001');
    });

    it('accepts the same cleared date on a sale, which shares the panel', async () => {
        const dto = plainToInstance(CreateSaleDto, saleBody({ ...CHEQUE, instrumentDate: '' }));

        expect(await validateBody(dto)).toHaveLength(0);
        expect(dto.payments?.[0].instrumentDate).toBeUndefined();
    });

    it('still refuses a date that is not one', async () => {
        const dto = plainToInstance(CreatePurchaseDto, purchaseBody({ instrumentDate: '25/09/2026' }));

        expect((await validateBody(dto)).length).toBeGreaterThan(0);
    });
});
