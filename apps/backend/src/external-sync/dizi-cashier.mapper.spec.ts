import { SyncWarning } from './external-sync.mapper';
import {
    mapDiziCustomer,
    mapDiziPayment,
    mapDiziProduct,
    mapDiziPurchase,
    mapDiziSale,
    mapDiziSaleReturn,
    mapDiziSupplier,
} from './dizi-cashier.mapper';

describe('mapDiziProduct', () => {
    it('maps the tax-inclusive prices and falls back to the barcode for a null SKU', () => {
        const claimed = new Set<string>();
        const mapped = mapDiziProduct(
            {
                Id: 'item-1',
                Name: 'Nebulizer',
                SKU: null,
                Barcode: 'BC-9',
                Description: null,
                ItemCategoryId: 'cat-1',
                PriceIncludingTax: 360,
                BuyingPriceIncludingTax: 300,
                WeightedAvgCost: 290,
                MinimumStock: 5,
                IsService: false,
                IsActive: true,
                IsDeleted: false,
                UpdatedOn: '2026-07-08T07:55:15.537',
            },
            claimed,
        );

        expect(mapped.externalId).toBe('item-1');
        expect(mapped.sku).toBe('BC-9');
        expect(mapped.price).toBe(360);
        expect(mapped.purchaseRate).toBe(300);
        expect(mapped.reorderLevel).toBe(5);
        expect(mapped.isService).toBe(false);
        // Dizi's UpdatedOn carries no zone; it parses as a local instant.
        expect(mapped.externalUpdatedAt).toEqual(new Date('2026-07-08T07:55:15.537'));
    });

    it('falls back to an EXT- code when both SKU and barcode are missing', () => {
        const mapped = mapDiziProduct(
            { Id: 'item-2', Name: 'X', SKU: null, Barcode: null } as any,
            new Set<string>(),
        );
        expect(mapped.sku).toBe('EXT-item-2');
    });

    it('uses the weighted average cost when no buying price is set', () => {
        const mapped = mapDiziProduct(
            { Id: 'i', Name: 'Y', BuyingPriceIncludingTax: null, WeightedAvgCost: 42 } as any,
            new Set<string>(),
        );
        expect(mapped.purchaseRate).toBe(42);
    });
});

describe('mapDiziCustomer / mapDiziSupplier', () => {
    it('carries the current balance across as the opening due', () => {
        const mapped = mapDiziCustomer(
            {
                Id: 'c1',
                Name: 'ZA Surgical',
                Code: null,
                ContactNo: '5252',
                ContactPerson: 'Mr Z',
                Email: null,
                Location: 'Dhaka',
                Balance: 1410,
            } as any,
            new Set<string>(),
        );
        expect(mapped.customerCode).toBe('EXT-c1');
        expect(mapped.phone).toBe('5252');
        expect(mapped.ownerName).toBe('Mr Z');
        expect(mapped.address).toBe('Dhaka');
        expect(mapped.previousDue).toBe(1410);
        expect(mapped.creditLimit).toBeNull();
    });

    it('disambiguates a duplicate supplier name with the external id', () => {
        const claimed = new Set<string>();
        const a = mapDiziSupplier({ Id: 's1', Name: 'ACME', Balance: 0 } as any, claimed);
        const b = mapDiziSupplier({ Id: 's2', Name: 'ACME', Balance: 0 } as any, claimed);
        expect(a.name).toBe('ACME');
        expect(b.name).toBe('ACME-s2');
    });
});

describe('mapDiziSale', () => {
    const header = {
        Id: 'sale-1',
        SlipNo: 'INV-100',
        TransactionDate: '2026-09-01T12:00:00',
        TraderId: 'c1',
        TotalAmount: 500,
        ReceivedAmount: 500,
        DueAmount: 0,
    } as any;

    it('maps header + detail into a document number and line items', () => {
        const warnings: SyncWarning[] = [];
        const detail = {
            Id: 'sale-1',
            SlipNo: 'INV-100',
            Date: '2026-09-01T12:00:00',
            CustomerId: 'c1',
            CashOrBankAccount: 'Cash',
            Narration: 'walk-in',
            SalesItems: [
                {
                    ItemId: 'item-1',
                    Quantity: 2,
                    PricePerUnitWithTax: 260,
                    DiscountedPricePerUnitWithTax: 250,
                    CostPrice: 200,
                },
            ],
        } as any;

        const mapped = mapDiziSale(header, detail, 'DZ-', warnings);

        expect(mapped.serialNumber).toBe('DZ-INV-100');
        expect(mapped.referenceNumber).toBe('INV-100');
        expect(mapped.externalCustomerId).toBe('c1');
        expect(mapped.paymentMode).toBe('cash');
        expect(mapped.saleDate).toEqual(new Date('2026-09-01T00:00:00.000Z'));
        expect(mapped.items).toEqual([
            { externalProductId: 'item-1', quantity: 2, priceAtSale: 250, unitCostAtSale: 200 },
        ]);
        expect(warnings).toHaveLength(0);
    });

    it('detects a bank settlement from the account name', () => {
        const mapped = mapDiziSale(header, { CashOrBankAccount: 'City Bank', SalesItems: [] } as any, 'DZ-', []);
        expect(mapped.paymentMode).toBe('bank');
    });

    it('rounds a fractional quantity and records a warning', () => {
        const warnings: SyncWarning[] = [];
        const mapped = mapDiziSale(
            header,
            { SalesItems: [{ ItemId: 'i', Quantity: 1.4, PricePerUnitWithTax: 10 }] } as any,
            'DZ-',
            warnings,
        );
        expect(mapped.items[0].quantity).toBe(1);
        expect(warnings[0].code).toBe('QUANTITY_ROUNDED');
    });

    it('tolerates a missing detail (dropped/failed fetch)', () => {
        const mapped = mapDiziSale(header, null, 'DZ-', []);
        expect(mapped.items).toEqual([]);
        expect(mapped.serialNumber).toBe('DZ-INV-100');
    });
});

describe('mapDiziPurchase', () => {
    it('maps subtotal/tax/discount from the detail and computes line totals', () => {
        const header = {
            Id: 'p1',
            SlipNo: 'PUR-5',
            TransactionDate: '2026-08-10T00:00:00',
            TraderId: 's1',
            TotalAmount: 1000,
            ReceivedAmount: 600,
        } as any;
        const detail = {
            Id: 'p1',
            SupplierId: 's1',
            BasePriceAmount: 900,
            TaxAmount: 100,
            DiscountAmount: 0,
            PaidAmount: 600,
            PurchaseItems: [{ ItemId: 'item-1', Quantity: 3, PricePerUnit: 300, DiscountedPricePerUnit: 300 }],
        } as any;

        const mapped = mapDiziPurchase(header, detail, 'DZ-', []);

        expect(mapped.purchaseNumber).toBe('DZ-PUR-5');
        expect(mapped.subtotalAmount).toBe(900);
        expect(mapped.taxAmount).toBe(100);
        expect(mapped.paidAmount).toBe(600);
        expect(mapped.paymentStatus).toBe('PARTIAL');
        expect(mapped.items[0]).toEqual({ externalProductId: 'item-1', quantity: 3, unitCost: 300, lineTotal: 900 });
    });
});

describe('mapDiziPayment', () => {
    const row = {
        Id: 'pay-1',
        TraderId: 'c1',
        Amount: 250,
        Date: '2026-09-02T00:00:00',
        SlipNo: 'PS-1',
        TransactionNo: 'TXN-9',
        MethodName: 'bKash',
        Narration: 'part payment',
    } as any;

    it('marks a customer payment as money in', () => {
        const mapped = mapDiziPayment(row, 'CUSTOMER', 'DZ-', []);
        expect(mapped?.direction).toBe('IN');
        expect(mapped?.paymentNumber).toBe('DZ-PS-1');
        expect(mapped?.externalPartyId).toBe('c1');
        expect(mapped?.note).toBe('part payment — via bKash');
    });

    it('marks a supplier payment as money out', () => {
        const mapped = mapDiziPayment(row, 'SUPPLIER', 'DZ-', []);
        expect(mapped?.direction).toBe('OUT');
    });

    it('skips a non-positive amount with a warning', () => {
        const warnings: SyncWarning[] = [];
        const mapped = mapDiziPayment({ ...row, Amount: 0 }, 'CUSTOMER', 'DZ-', warnings);
        expect(mapped).toBeNull();
        expect(warnings[0].code).toBe('PAYMENT_AMOUNT_INVALID');
    });
});

describe('mapDiziSaleReturn', () => {
    it('links to the parent sale via SalesId and maps line refunds', () => {
        const detail = {
            Id: 'r1',
            ReturnSlipNo: 'RET-2',
            ReturnDate: '2026-09-03T00:00:00',
            SalesId: 'sale-1',
            TraderId: 'c1',
            GrossAmount: 250,
            TotalAmount: 250,
            Narration: 'wrong item',
            ReturnItems: [{ ItemId: 'item-1', SaleItemId: 'si-1', Quantity: 1, TotalAmount: 250, PricePerItem: 250 }],
        } as any;

        const mapped = mapDiziSaleReturn(detail, 'DZ-', []);

        expect(mapped.returnNumber).toBe('DZ-RET-2');
        expect(mapped.externalSaleId).toBe('sale-1');
        expect(mapped.totalRefund).toBe(250);
        expect(mapped.items).toEqual([{ externalProductId: 'item-1', quantity: 1, refundAmount: 250 }]);
    });

    it('falls back to unit price × quantity when a line has no total', () => {
        const mapped = mapDiziSaleReturn(
            {
                Id: 'r2',
                ReturnSlipNo: 'RET-3',
                ReturnDate: '2026-09-03T00:00:00',
                SalesId: null,
                GrossAmount: 0,
                ReturnItems: [{ ItemId: 'i', Quantity: 2, TotalAmount: 0, PricePerItem: 50 }],
            } as any,
            'DZ-',
            [],
        );
        expect(mapped.externalSaleId).toBeNull();
        expect(mapped.items[0].refundAmount).toBe(100);
    });
});
