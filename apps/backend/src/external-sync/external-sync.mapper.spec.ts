import {
    buildDocumentNumber,
    dedupeCode,
    groupBy,
    mapCustomer,
    mapProduct,
    mapPurchase,
    mapSale,
    mapSupplier,
    parseProviderDate,
    resolvePaymentStatus,
    resolveQuantity,
    splitIntoMonthlyWindows,
    toMoney,
    type SyncWarning,
} from './external-sync.mapper';

describe('external-sync mapper', () => {
    describe('splitIntoMonthlyWindows', () => {
        it('splits a multi-month range on calendar month boundaries', () => {
            const windows = splitIntoMonthlyWindows(new Date('2026-01-15'), new Date('2026-03-10'));

            expect(windows).toEqual([
                { from: '2026-01-15', to: '2026-01-31' },
                { from: '2026-02-01', to: '2026-02-28' },
                { from: '2026-03-01', to: '2026-03-10' },
            ]);
        });

        it('handles a range inside a single month', () => {
            expect(splitIntoMonthlyWindows(new Date('2026-05-03'), new Date('2026-05-09'))).toEqual([
                { from: '2026-05-03', to: '2026-05-09' },
            ]);
        });

        it('covers leap-year February without dropping the 29th', () => {
            const windows = splitIntoMonthlyWindows(new Date('2028-02-01'), new Date('2028-03-01'));
            expect(windows[0]).toEqual({ from: '2028-02-01', to: '2028-02-29' });
        });

        it('returns nothing when the range is inverted', () => {
            expect(splitIntoMonthlyWindows(new Date('2026-03-01'), new Date('2026-01-01'))).toEqual([]);
        });
    });

    describe('parseProviderDate', () => {
        it('anchors plain provider dates at UTC midnight so no timezone shifts the day', () => {
            expect(parseProviderDate('2026-07-23').toISOString()).toBe('2026-07-23T00:00:00.000Z');
        });
    });

    describe('toMoney', () => {
        it('parses the provider 3dp strings down to 2dp', () => {
            expect(toMoney('2200.000')).toBe(2200);
            expect(toMoney('1799.995')).toBe(1800);
            expect(toMoney('0.125')).toBe(0.13);
        });

        it('treats missing and unparseable values as zero rather than NaN', () => {
            expect(toMoney(null)).toBe(0);
            expect(toMoney('')).toBe(0);
            expect(toMoney('not-a-number')).toBe(0);
        });
    });

    describe('resolveQuantity', () => {
        it('passes whole quantities through untouched', () => {
            expect(resolveQuantity('23.00')).toEqual({ quantity: 23, rounded: false, originalQuantity: 23 });
        });

        it('rounds fractional quantities and flags that it did', () => {
            expect(resolveQuantity('0.80')).toEqual({ quantity: 1, rounded: true, originalQuantity: 0.8 });
        });

        it('never rounds a real line down to a zero quantity', () => {
            expect(resolveQuantity('0.13')).toEqual({ quantity: 1, rounded: true, originalQuantity: 0.13 });
            expect(resolveQuantity('0.20')).toEqual({ quantity: 1, rounded: true, originalQuantity: 0.2 });
        });
    });

    describe('dedupeCode', () => {
        it('keeps the first claim on a code and disambiguates later collisions', () => {
            const claimed = new Set<string>();
            expect(dedupeCode('P01139', '900', claimed)).toBe('P01139');
            expect(dedupeCode('P01139', '901', claimed)).toBe('P01139-901');
        });

        it('synthesises a code when the provider supplies none', () => {
            expect(dedupeCode('', '4242', new Set())).toBe('EXT-4242');
        });
    });

    describe('buildDocumentNumber', () => {
        it('prefixes so imported numbers cannot collide with POS-generated ones', () => {
            expect(buildDocumentNumber('XR-', '2601666')).toBe('XR-2601666');
        });
    });

    describe('resolvePaymentStatus', () => {
        it('classifies unpaid, partial and paid', () => {
            expect(resolvePaymentStatus(1000, 0)).toBe('UNPAID');
            expect(resolvePaymentStatus(1000, 400)).toBe('PARTIAL');
            expect(resolvePaymentStatus(1000, 1000)).toBe('PAID');
        });

        it('tolerates sub-cent drift from the provider 3dp amounts', () => {
            expect(resolvePaymentStatus(660, 659.998)).toBe('PAID');
        });
    });

    describe('groupBy', () => {
        it('groups line rows under their parent document id', () => {
            const grouped = groupBy(
                [{ sale_id: '1' }, { sale_id: '2' }, { sale_id: '1' }],
                (row) => row.sale_id,
            );
            expect(grouped.get('1')).toHaveLength(2);
            expect(grouped.get('2')).toHaveLength(1);
        });
    });

    describe('mapSale', () => {
        const header: any = {
            id: 558868,
            invoice: '2601666',
            customer_id: '64505',
            date: '2026-07-23',
            subtotal: '2200.000',
            discountAmount: '0.000',
            vatAmount: '0.000',
            transport_cost: '0.000',
            total: '2200.000',
            paid: '2200.000',
            due: '0.000',
            returnAmount: '0.000',
            description: 'courier to Patuakhali',
            sale_type: 'retail',
            status: 'a',
            organization_id: '262',
            created_at: '2026-07-23T12:31:15.000000Z',
            updated_at: '2026-07-23T12:31:15.000000Z',
        };

        it('maps a header and its lines onto our sale shape', () => {
            const warnings: SyncWarning[] = [];
            const mapped = mapSale(
                header,
                [
                    { id: '1', sale_id: '558868', product_id: '98224', quantity: '23.00', purchase_rate: '1750.000', unit_price: '1800.000', organization_id: '262' },
                ],
                'XR-',
                warnings,
            );

            expect(mapped.serialNumber).toBe('XR-2601666');
            expect(mapped.totalAmount).toBe(2200);
            expect(mapped.amountPaid).toBe(2200);
            expect(mapped.saleDate.toISOString()).toBe('2026-07-23T00:00:00.000Z');
            expect(mapped.note).toBe('courier to Patuakhali');
            expect(mapped.externalCustomerId).toBe('64505');
            expect(mapped.items).toEqual([
                { externalProductId: '98224', quantity: 23, priceAtSale: 1800, unitCostAtSale: 1750 },
            ]);
            expect(warnings).toHaveLength(0);
        });

        it('records a warning when a fractional line quantity has to be rounded', () => {
            const warnings: SyncWarning[] = [];
            mapSale(
                header,
                [
                    { id: '1', sale_id: '558868', product_id: '98224', quantity: '0.50', purchase_rate: '0.000', unit_price: '100.000', organization_id: '262' },
                ],
                'XR-',
                warnings,
            );

            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toMatchObject({ entity: 'SALE', code: 'QUANTITY_ROUNDED', externalId: '558868' });
        });

        it('treats a missing customer as a walk-in rather than inventing one', () => {
            const mapped = mapSale({ ...header, customer_id: null }, [], 'XR-', []);
            expect(mapped.externalCustomerId).toBeNull();
        });

        it('leaves unit cost null when the provider reports no purchase rate', () => {
            const mapped = mapSale(
                header,
                [
                    { id: '1', sale_id: '558868', product_id: '98224', quantity: '1', purchase_rate: '0.000', unit_price: '10.000', organization_id: '262' },
                ],
                'XR-',
                [],
            );
            expect(mapped.items[0].unitCostAtSale).toBeNull();
        });
    });

    describe('mapPurchase', () => {
        const header: any = {
            id: 129245,
            invoice: '2601096',
            supplier_id: '5788',
            date: '2026-07-23',
            subtotal: '660.000',
            discountAmount: '0.000',
            vatAmount: '0.000',
            transport_cost: '0.000',
            total: '660.000',
            paid: '660.000',
            due: '0.000',
            description: null,
            status: 'a',
            organization_id: '262',
            created_at: '2026-07-23T10:00:00.000000Z',
            updated_at: null,
        };

        it('maps a purchase and derives its line totals and payment status', () => {
            const mapped = mapPurchase(
                header,
                [
                    { id: '1', purchase_id: '129245', product_id: '99189', quantity: '102.00', unit_price: '620.000', organization_id: '262' },
                ],
                'XR-',
                [],
            );

            expect(mapped.purchaseNumber).toBe('XR-2601096');
            expect(mapped.paymentStatus).toBe('PAID');
            expect(mapped.items).toEqual([
                { externalProductId: '99189', quantity: 102, unitCost: 620, lineTotal: 63240 },
            ]);
        });

        it('marks a partly paid purchase as PARTIAL', () => {
            const mapped = mapPurchase({ ...header, paid: '100.000' }, [], 'XR-', []);
            expect(mapped.paymentStatus).toBe('PARTIAL');
        });
    });

    describe('master data mapping', () => {
        it('maps a product and treats a zero VAT rate as "no override"', () => {
            const mapped = mapProduct(
                { id: 1, code: 'P01212', name: ' Widget ', purchase_rate: '10.000', sale_rate: '15.000', vat: '0.000', reorder: '5', is_service: 'false', status: 'a', organization_id: '262', updated_at: null } as any,
                new Set(),
            );

            expect(mapped).toMatchObject({ sku: 'P01212', name: 'Widget', price: 15, vatRate: null, reorderLevel: 5, isService: false });
        });

        it('discards the provider sentinel credit limit', () => {
            const mapped = mapCustomer(
                { id: 7, code: 'C00564', name: 'Fatiha Surgical', owner_name: null, phone: '01725210121', email: null, address: null, credit_limit: '1000000000.000', organization_id: '262', updated_at: null } as any,
                new Set(),
            );
            expect(mapped.creditLimit).toBeNull();
        });

        it('keeps a real credit limit', () => {
            const mapped = mapCustomer(
                { id: 7, code: 'C1', name: 'X', owner_name: null, phone: null, email: null, address: null, credit_limit: '50000.000', organization_id: '262', updated_at: null } as any,
                new Set(),
            );
            expect(mapped.creditLimit).toBe(50000);
        });

        it('disambiguates supplier names because our schema makes them unique per tenant', () => {
            const claimed = new Set<string>();
            const first = mapSupplier({ id: 1, code: 'S1', name: 'Acme', phone: null, email: null, address: null, organization_id: '262', updated_at: null } as any, claimed);
            const second = mapSupplier({ id: 2, code: 'S2', name: 'Acme', phone: null, email: null, address: null, organization_id: '262', updated_at: null } as any, claimed);

            expect(first.name).toBe('Acme');
            expect(second.name).toBe('Acme-2');
        });

        it('parses both provider timestamp formats', () => {
            const iso = mapProduct({ id: 1, code: 'A', name: 'A', purchase_rate: null, sale_rate: null, vat: null, reorder: null, is_service: 'false', status: 'a', organization_id: '262', updated_at: '2026-07-23T12:31:15.000000Z' } as any, new Set());
            const plain = mapProduct({ id: 2, code: 'B', name: 'B', purchase_rate: null, sale_rate: null, vat: null, reorder: null, is_service: 'false', status: 'a', organization_id: '262', updated_at: '2025-07-24 16:01:53' } as any, new Set());

            expect(iso.externalUpdatedAt?.toISOString()).toBe('2026-07-23T12:31:15.000Z');
            expect(plain.externalUpdatedAt?.toISOString()).toBe('2025-07-24T16:01:53.000Z');
        });
    });
});
