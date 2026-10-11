import { ExternalSyncService } from './external-sync.service';
import { EXPRESS_RETAIL_DEFINITION } from './provider-adapter';

/**
 * The three causes behind the records an Express import skipped, each now
 * imported instead: a number Express handed out twice, a line of quantity 0,
 * and a customer Express left out of its list but still names on payments.
 * Shaped from the real rows, names dropped.
 */

const MAPPERS = EXPRESS_RETAIL_DEFINITION.mappers;
const CONNECTION = {
    id: 'conn-1',
    tenant_id: 'tenant-1',
    store_id: 'store-1',
    provider: 'EXPRESS_RETAIL_PRO',
    document_prefix: 'XR-',
    post_impacts: false,
};
const WINDOW = { from: '2021-10-12', to: '2026-10-11' };
const OPENING = new Date('2021-10-12T00:00:00.000Z');

function emptyStats() {
    const tally = () => ({ created: 0, updated: 0, skipped: 0 });
    return {
        products: tally(),
        customers: tally(),
        suppliers: tally(),
        sales: tally(),
        purchases: tally(),
        customerPayments: tally(),
        supplierPayments: tally(),
        saleReturns: tally(),
        quotations: tally(),
    };
}

function makeDb(taken: { quoteNumbers?: string[] } = {}) {
    const db: any = {
        externalSyncMapping: {
            findMany: jest.fn(async () => []),
            upsert: jest.fn(async () => ({})),
            deleteMany: jest.fn(async () => ({ count: 0 })),
        },
        quotation: {
            findFirst: jest.fn(async ({ where }: any) =>
                (taken.quoteNumbers ?? []).includes(where.quote_number) ? { id: 'someone-else' } : null,
            ),
            create: jest.fn(async () => ({ id: 'quote-new' })),
        },
        customer: {
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async () => ({ store_id: 'store-1' })),
            create: jest.fn(async () => ({ id: 'cust-new' })),
        },
        customerCreditTransaction: {
            findFirst: jest.fn(async () => null),
            create: jest.fn(async () => ({ id: 'ct-1' })),
        },
    };
    db.$transaction = jest.fn(async (run: (tx: any) => Promise<unknown>) => run(db));
    return db;
}

const service = (db: any) => new ExternalSyncService(db, {} as any, {} as any) as any;

const QUOTATION = {
    header: {
        id: 1213,
        invoice: '2500028',
        customer_id: '46764',
        date: '2025-08-23',
        total: '436430.000',
        description: null,
        updated_at: '2025-08-23T09:49:06.000000Z',
    },
    lines: [{ id: '1', quotation_id: '1213', product_id: '98497', quantity: '10.00', unit_price: '670.000', total: '6700.000' }],
};

describe('a number Express handed out twice', () => {
    it('imports the second quotation under a suffixed number and says so', async () => {
        const db = makeDb({ quoteNumbers: ['XR-2500028'] });
        const stats = emptyStats();
        const warnings: any[] = [];

        await service(db).syncQuotationsWindow(
            CONNECTION,
            { fetchQuotationDocuments: jest.fn(async () => [QUOTATION]) },
            WINDOW,
            new Map([['98497', 'prod-1']]),
            new Map([['46764', 'cust-1']]),
            stats,
            warnings,
            false,
            MAPPERS,
            OPENING,
        );

        expect(db.quotation.create.mock.calls[0][0].data.quote_number).toBe('XR-2500028-2');
        expect(stats.quotations).toEqual({ created: 1, updated: 0, skipped: 0 });
        expect(warnings).toEqual([
            expect.objectContaining({ code: 'NUMBER_TAKEN', message: 'XR-2500028 is already used by another record here — imported as XR-2500028-2' }),
        ]);
    });
});

describe('a line of quantity 0', () => {
    it('is dropped with one note per document, and the other lines kept', () => {
        const warnings: any[] = [];
        const items = service(makeDb()).resolveDocumentItems(
            [
                { externalProductId: 'a', quantity: 5 },
                { externalProductId: 'b', quantity: 0 },
                { externalProductId: 'c', quantity: 0 },
            ],
            new Map([['a', 'prod-a'], ['b', 'prod-b'], ['c', 'prod-c']]),
            warnings,
            'PURCHASE',
            'p-1',
            'XR-2500001',
        );

        expect(items).toEqual([{ productId: 'prod-a', source: { externalProductId: 'a', quantity: 5 } }]);
        expect(warnings).toEqual([
            expect.objectContaining({ code: 'ZERO_QUANTITY_DROPPED', message: 'XR-2500001: 2 lines with quantity 0 dropped — nothing was bought or sold on them' }),
        ]);
    });
});

describe('a payment naming a customer missing from the customer list', () => {
    const PAYMENT = {
        id: 130001,
        invoice: 'TR00051',
        date: '2025-08-24',
        customer_id: '48078',
        type: 'CR',
        method: 'cash',
        bank_account_id: null,
        amount: '10000.000',
        previous_due: null,
        note: null,
        status: 'a',
        organization_id: '262',
        updated_at: null,
        customer: { id: 48078, code: 'C00203', name: 'Some Pharmacy', owner_name: null, phone: '01700000000' },
    };

    async function pay(db: any, row: unknown) {
        const stats = emptyStats();
        const warnings: any[] = [];
        const partyMap = new Map<string, string>();
        await service(db).syncPaymentsWindow(
            CONNECTION,
            { fetchPayments: jest.fn(async () => [row]) },
            WINDOW,
            'CUSTOMER',
            partyMap,
            stats,
            warnings,
            false,
            MAPPERS,
            OPENING,
        );
        return { stats, warnings, partyMap };
    }

    it('creates the customer from the payment, then imports the payment', async () => {
        const db = makeDb();
        const { stats, warnings, partyMap } = await pay(db, PAYMENT);

        expect(db.customer.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ customer_code: 'C00203', name: 'Some Pharmacy', phone: '01700000000', store_id: 'store-1' }),
            select: { id: true },
        });
        expect(partyMap.get('48078')).toBe('cust-new');
        expect(db.externalSyncMapping.upsert.mock.calls[0][0].create).toMatchObject({ entity_type: 'CUSTOMER', external_id: '48078', internal_id: 'cust-new' });
        expect(stats.customers.created).toBe(1);
        expect(stats.customerPayments).toEqual({ created: 1, updated: 0, skipped: 0 });
        expect(warnings.map((w) => w.code)).toEqual(['PARTY_FROM_DOCUMENT']);
        expect(warnings[0].message).toBe("Customer C00203 Some Pharmacy is not in the provider's customer list — created from payment TR00051");
    });

    it('still skips, with the details, a payment that carries no copy of its customer', async () => {
        const db = makeDb();
        const { stats, warnings } = await pay(db, { ...PAYMENT, customer: null });

        expect(db.customer.create).not.toHaveBeenCalled();
        expect(stats.customerPayments.skipped).toBe(1);
        expect(warnings).toEqual([
            expect.objectContaining({
                code: 'PARTY_UNRESOLVED',
                skipped: { number: 'TR00051', date: '2025-08-24', party: '#48078', amount: 10000, lines: null },
            }),
        ]);
    });

    it('describes a zero-amount payment it skips', async () => {
        const { warnings } = await pay(makeDb(), { ...PAYMENT, amount: '0.000' });
        expect(warnings).toEqual([
            expect.objectContaining({
                code: 'PAYMENT_AMOUNT_INVALID',
                skipped: { number: 'TR00051', date: '2025-08-24', party: 'C00203 Some Pharmacy', amount: 0, lines: null },
            }),
        ]);
    });
});
