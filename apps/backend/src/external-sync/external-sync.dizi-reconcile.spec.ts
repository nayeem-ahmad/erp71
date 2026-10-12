import { ExternalSyncService } from './external-sync.service';
import { DIZI_CASHIER_DEFINITION } from './provider-adapter';

/**
 * What lets a Dizi branch be re-imported over itself, with no clear, and come
 * out matching Dizi: purchases first saved as paid are put right, returns
 * already imported get their credit, and parties and products the tenant
 * already has get the opening Dizi holds beyond its documents — once, and only
 * where the run covers their whole history.
 */

const applyInventoryMovement: jest.Mock = jest.fn(async () => 0);
const autoPostFromRules: jest.Mock = jest.fn(async () => ({ postingStatus: 'posted' }));

jest.mock('../database/inventory.utils', () => ({
    ...jest.requireActual('../database/inventory.utils'),
    applyInventoryMovement: (...args: any[]) => applyInventoryMovement(...args),
    resolveWarehouseId: async () => 'wh-1',
}));
jest.mock('../accounting/payment-account.util', () => ({
    resolvePaymentMethodAccountId: async () => 'acct-cash',
}));
jest.mock('../accounting/posting.utils', () => ({
    ...jest.requireActual('../accounting/posting.utils'),
    autoPostFromRules: (...args: any[]) => autoPostFromRules(...args),
}));

const MAPPERS = DIZI_CASHIER_DEFINITION.mappers;
const CONNECTION = {
    id: 'conn-1',
    tenant_id: 'tenant-1',
    store_id: 'store-1',
    provider: 'DIZI_CASHIER',
    document_prefix: 'DZ-',
    post_impacts: true,
};
const OPENING = new Date('2026-06-01T00:00:00.000Z');

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
        purchaseReturns: tally(),
    };
}

function makeDb(mappings: Record<string, Array<[string, string]>> = {}) {
    const db: any = {
        externalSyncMapping: {
            findMany: jest.fn(async ({ where }: any) =>
                (mappings[where.entity_type] ?? []).map(([external_id, internal_id]) => ({ external_id, internal_id })),
            ),
            upsert: jest.fn(async () => ({})),
            deleteMany: jest.fn(async () => ({ count: 0 })),
        },
        customer: {
            updateMany: jest.fn(async () => ({ count: 1 })),
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async () => ({ store_id: 'store-1', due_balance: 400 })),
            create: jest.fn(async () => ({ id: 'cust-new' })),
            update: jest.fn(async () => ({})),
        },
        customerCreditTransaction: {
            findFirst: jest.fn(async () => null),
            create: jest.fn(async () => ({ id: 'ct-1' })),
        },
        supplier: {
            findUnique: jest.fn(async () => ({ store_id: 'store-1', due_balance: -2120 })),
            update: jest.fn(async () => ({})),
        },
        supplierCreditTransaction: {
            findFirst: jest.fn(async () => null),
            create: jest.fn(async () => ({ id: 'st-1' })),
            update: jest.fn(async () => ({})),
        },
        product: { updateMany: jest.fn(async () => ({ count: 1 })) },
        productCost: { findMany: jest.fn(async () => [{ product_id: 'prod-1' }]) },
        productPrice: { findMany: jest.fn(async () => []) },
        inventoryMovement: { findFirst: jest.fn(async () => null) },
        purchase: {
            findFirst: jest.fn(async () => ({ id: 'pur-1', total_amount: 2120, paid_amount: 2120, supplier_id: 'sup-1', created_at: OPENING })),
            update: jest.fn(async () => ({})),
        },
        postingEvent: { findUnique: jest.fn(async () => ({ status: 'posted' })) },
        sale: { findUnique: jest.fn(async () => ({ customer_id: 'cust-1' })) },
        saleItem: { findMany: jest.fn(async () => [{ id: 'si-1', product_id: 'prod-1' }]) },
        salesReturn: { findFirst: jest.fn(async () => ({ id: 'ret-1' })), update: jest.fn(async () => ({})) },
        salesReturnItem: { deleteMany: jest.fn(async () => ({})), createMany: jest.fn(async () => ({})) },
    };
    db.$transaction = jest.fn(async (run: (tx: any) => Promise<unknown>) => run(db));
    return db;
}

const service = (db: any) => new ExternalSyncService(db, {} as any, {} as any) as any;

beforeEach(() => jest.clearAllMocks());

describe('a Dizi purchase first imported as already paid', () => {
    const doc = {
        header: { Id: 'p1', SlipNo: 'P-26182', TransactionDate: '2026-09-05T20:03:02', TraderId: 's1', TotalAmount: 2120, ReceivedAmount: 0 },
        detail: { Id: 'p1', SupplierId: 's1', BasePriceAmount: 2120, PaidAmount: 2120, PurchaseItems: [{ ItemId: 'item-1', Quantity: 2, PricePerUnit: 1060 }] },
    };

    async function rerun(db: any) {
        const stats = emptyStats();
        const warnings: any[] = [];
        await service(db).syncPurchasesWindow(
            CONNECTION,
            { fetchPurchaseDocuments: jest.fn(async () => [doc]) },
            { from: '2026-06-01', to: '2026-10-11' },
            new Map([['item-1', 'prod-1']]),
            new Map([['s1', 'sup-1']]),
            stats,
            warnings,
            false,
            MAPPERS,
            OPENING,
        );
        return { stats, warnings };
    }

    it("is marked unpaid on a re-run, and its total goes back on the supplier's due, though it has posted", async () => {
        const db = makeDb({ PURCHASE: [['p1', 'pur-1']] });

        const { stats, warnings } = await rerun(db);

        expect(db.purchase.update).toHaveBeenCalledWith({ where: { id: 'pur-1' }, data: { paid_amount: 0, payment_status: 'UNPAID' } });
        expect(db.supplierCreditTransaction.create.mock.calls[0][0].data).toMatchObject({
            supplier_id: 'sup-1',
            type: 'CREDIT_PURCHASE',
            amount: 2120,
            balance_after: 0,
            reference_type: 'PURCHASE',
            reference_id: 'pur-1',
        });
        expect(db.supplier.update).toHaveBeenCalledWith({ where: { id: 'sup-1' }, data: { due_balance: 0 } });
        expect(stats.purchases.updated).toBe(1);
        expect(warnings).toEqual([]);
    });

    it('still refuses a posted purchase whose total has changed', async () => {
        const db = makeDb({ PURCHASE: [['p1', 'pur-1']] });
        db.purchase.findFirst.mockResolvedValue({ id: 'pur-1', total_amount: 1999, paid_amount: 1999, supplier_id: 'sup-1', created_at: OPENING });

        const { warnings } = await rerun(db);

        expect(db.purchase.update).not.toHaveBeenCalled();
        expect(warnings).toEqual([expect.objectContaining({ code: 'POSTED_IMMUTABLE' })]);
    });
});

describe('a Dizi return imported before returns were credited', () => {
    const detail = {
        Id: 'r1',
        ReturnSlipNo: 'SR-26060',
        ReturnDate: '2026-09-26T23:44:00',
        SalesId: 'sale-1',
        TraderId: 'c1',
        GrossAmount: 1660,
        TotalAmount: 1660,
        ReturnItems: [{ ItemId: 'item-1', Quantity: 2, TotalAmount: 1660 }],
    };

    async function rerun(db: any) {
        await service(db).syncSaleReturnsWindow(
            CONNECTION,
            { fetchSaleReturnDocuments: jest.fn(async () => [detail]) },
            { from: '2026-06-01', to: '2026-10-11' },
            new Map([['item-1', 'prod-1']]),
            new Map([['sale-1', 'sale-int-1']]),
            new Map([['c1', 'cust-1']]),
            emptyStats(),
            [],
            false,
            MAPPERS,
        );
    }

    it("is credited to its sale's customer on a re-run", async () => {
        const db = makeDb({ SALE_RETURN: [['r1', 'ret-1']] });
        db.postingEvent.findUnique.mockResolvedValue({ status: 'skipped' });

        await rerun(db);

        expect(db.customerCreditTransaction.create.mock.calls[0][0].data).toMatchObject({
            customer_id: 'cust-1',
            amount: -1660,
            reference_type: 'SALES_RETURN',
            reference_id: 'ret-1',
        });
        expect(autoPostFromRules.mock.calls[0][0]).toMatchObject({ eventType: 'sale_return', conditionValue: 'credit' });
    });

    it('gets no second credit', async () => {
        const db = makeDb({ SALE_RETURN: [['r1', 'ret-1']] });
        db.postingEvent.findUnique.mockResolvedValue({ status: 'skipped' });
        db.customerCreditTransaction.findFirst.mockResolvedValue({ id: 'already' });

        await rerun(db);

        expect(db.customerCreditTransaction.create).not.toHaveBeenCalled();
    });
});

describe('opening dues for parties the tenant already has', () => {
    async function syncCustomers(db: any, openings: Map<string, number>) {
        const warnings: any[] = [];
        await service(db).syncCustomers(
            CONNECTION,
            { fetchCustomers: jest.fn(async () => [{ Id: 'c1', Name: 'Raymart', ContactNo: '01580383731', Balance: 53010 }]) },
            emptyStats(),
            warnings,
            false,
            OPENING,
            MAPPERS,
            openings,
        );
        return warnings;
    }

    it("adds the opening when the run covers the customer's whole history", async () => {
        const db = makeDb({ CUSTOMER: [['c1', 'cust-1']] });

        const warnings = await syncCustomers(db, new Map([['c1', 90250]]));

        expect(db.customerCreditTransaction.create.mock.calls[0][0].data).toMatchObject({
            customer_id: 'cust-1',
            type: 'ADJUSTMENT',
            amount: 90250,
            balance_after: 90650,
            created_at: OPENING,
        });
        expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 'cust-1' }, data: { due_balance: 90650 } });
        expect(warnings).toEqual([expect.objectContaining({ code: 'OPENING_FROM_PROVIDER' })]);
    });

    it('leaves a customer alone who already has an opening, or anything from before the range', async () => {
        const db = makeDb({ CUSTOMER: [['c1', 'cust-1']] });
        db.customerCreditTransaction.findFirst.mockResolvedValue({ id: 'earlier' });

        const warnings = await syncCustomers(db, new Map([['c1', 90250]]));

        const blockedBy = db.customerCreditTransaction.findFirst.mock.calls[0][0].where;
        expect(blockedBy.OR).toEqual([
            { notes: 'Opening balance imported from DIZI_CASHIER' },
            { created_at: { lt: OPENING } },
            // A balance typed in by hand: the tenant already has what they owe.
            {
                type: 'ADJUSTMENT',
                reference_type: null,
                OR: [{ notes: null }, { NOT: { notes: { startsWith: 'Opening balance imported from ' } } }],
            },
        ]);
        expect(db.customerCreditTransaction.create).not.toHaveBeenCalled();
        expect(warnings).toEqual([]);
    });
});

describe('opening stock', () => {
    async function syncProducts(db: any, openings: Map<string, number>) {
        const warnings: any[] = [];
        await service(db).syncProducts(
            CONNECTION,
            { fetchProducts: jest.fn(async () => [{ Id: 'item-1', Name: 'Belt', StockInHand: 12, BuyingPriceIncludingTax: 820, IsService: false }]) },
            emptyStats(),
            warnings,
            false,
            MAPPERS,
            openings,
            OPENING,
        );
        return warnings;
    }

    it("brings in what Dizi holds beyond its documents, into the branch's warehouse, at the buying rate", async () => {
        const db = makeDb({ PRODUCT: [['item-1', 'prod-1']] });

        const warnings = await syncProducts(db, new Map([['item-1', 9]]));

        expect(applyInventoryMovement.mock.calls[0][1]).toMatchObject({
            productId: 'prod-1',
            warehouseId: 'wh-1',
            quantityDelta: 9,
            movementType: 'INITIAL_STOCK',
            referenceType: 'EXTERNAL_SYNC_OPENING',
            referenceId: 'conn-1',
            unitCost: 820,
            occurredAt: OPENING,
        });
        expect(warnings).toEqual([expect.objectContaining({ code: 'OPENING_FROM_PROVIDER', entity: 'PRODUCT' })]);
    });

    it('adds no second opening, and none where the warehouse holds earlier history', async () => {
        const db = makeDb({ PRODUCT: [['item-1', 'prod-1']] });
        db.inventoryMovement.findFirst.mockResolvedValue({ id: 'earlier' });

        await syncProducts(db, new Map([['item-1', 9]]));

        expect(db.inventoryMovement.findFirst.mock.calls[0][0].where).toMatchObject({
            product_id: 'prod-1',
            warehouse_id: 'wh-1',
            OR: [{ reference_type: 'EXTERNAL_SYNC_OPENING', reference_id: 'conn-1' }, { created_at: { lt: OPENING } }],
        });
        expect(applyInventoryMovement).not.toHaveBeenCalled();
    });
});

describe('Express parties and sales kept through a clear', () => {
    const EXPRESS = { ...CONNECTION, provider: 'EXPRESS_RETAIL_PRO', document_prefix: 'XR-' };
    const XR = require('./provider-adapter').EXPRESS_RETAIL_DEFINITION.mappers;

    it("gives an existing customer back their Express opening due", async () => {
        const db = makeDb({ CUSTOMER: [['45448', 'cust-1']] });

        await service(db).syncCustomers(
            EXPRESS,
            { fetchCustomers: jest.fn(async () => [{ id: 45448, code: 'C00061', name: 'FENI. JAHAN SURGICAL', phone: '01838598820', previous_due: '126000.000' }]) },
            emptyStats(),
            [],
            false,
            OPENING,
            XR,
        );

        expect(db.customerCreditTransaction.create.mock.calls[0][0].data).toMatchObject({
            customer_id: 'cust-1',
            type: 'ADJUSTMENT',
            amount: 126000,
            notes: 'Opening balance imported from EXPRESS_RETAIL_PRO',
        });
    });

    it('books what an already-imported, posted sale was paid above its total', async () => {
        const db = makeDb({ SALE: [['292091', 'sale-1']] });
        db.sale = {
            // Only the imported sale itself is found; its provider number is free.
            findFirst: jest.fn(async ({ where }: any) =>
                where.reference_number ? null : { id: 'sale-1', customer_id: 'cust-1', total_amount: 54850, serial_number: 'XR-2500778' },
            ),
        };
        db.saleItem.findMany = jest.fn(async () => []);
        const stats = emptyStats();
        const warnings: any[] = [];

        await service(db).syncSalesWindow(
            EXPRESS,
            {
                fetchSaleDocuments: jest.fn(async () => [
                    { header: { id: 292091, invoice: '2500778', customer_id: '47252', date: '2025-10-29', total: '54850.000', paid: '113065.000', cashPaid: '113065.000', bankPaid: '0.000' }, lines: [] },
                ]),
            },
            { from: '2021-10-12', to: '2026-10-11' },
            new Map(),
            new Map([['47252', 'cust-1']]),
            stats,
            warnings,
            false,
            XR,
            OPENING,
        );

        expect(db.customerCreditTransaction.create.mock.calls[0][0].data).toMatchObject({
            customer_id: 'cust-1',
            type: 'PAYMENT',
            amount: 58215,
            reference_type: 'SALE',
            reference_id: 'sale-1',
        });
        expect(warnings).toEqual([]);
        expect(stats.sales.updated).toBe(1);
        expect(warnings.filter((w) => w.code === 'POSTED_IMMUTABLE')).toEqual([]);
    });
});

describe('Express purchases and purchase returns already imported', () => {
    const EXPRESS = { ...CONNECTION, provider: 'EXPRESS_RETAIL_PRO', document_prefix: 'XR-' };
    const XR = require('./provider-adapter').EXPRESS_RETAIL_DEFINITION.mappers;
    // The purchase itself has posted; its paid-with-the-goods leg has not.
    const postedButNotPaid = jest.fn(async ({ where }: any) =>
        where.tenant_id_idempotency_key.idempotency_key.endsWith(':paid') ? null : { status: 'posted' },
    );

    it('posts what a posted purchase was paid with the goods', async () => {
        const db = makeDb({ PURCHASE: [['74956', 'pur-1']] });
        db.postingEvent.findUnique = postedButNotPaid;
        db.purchase.findFirst.mockResolvedValue({ id: 'pur-1', total_amount: 161280, paid_amount: 161280, supplier_id: 'sup-1', purchase_number: 'XR-2500030', created_at: OPENING });
        const stats = emptyStats();
        const warnings: any[] = [];

        await service(db).syncPurchasesWindow(
            EXPRESS,
            { fetchPurchaseDocuments: jest.fn(async () => [{ header: { id: 74956, invoice: '2500030', supplier_id: '4232', date: '2025-07-21', subtotal: '161280', total: '161280', paid: '161280' }, lines: [] }]) },
            { from: '2021-10-12', to: '2026-10-11' },
            new Map(),
            new Map([['4232', 'sup-1']]),
            stats,
            warnings,
            false,
            XR,
            OPENING,
        );

        expect(autoPostFromRules.mock.calls[0][0]).toMatchObject({ eventType: 'supplier_payment', legKey: 'paid', amount: 161280, partyId: 'sup-1' });
        expect(stats.purchases.updated).toBe(1);
        expect(warnings).toEqual([]);
    });

    it("gives a posted return imported under the old cap the rest of its credit", async () => {
        const db = makeDb();
        db.purchaseReturn = { findFirst: jest.fn(async () => ({ id: 'pr-1' })) };

        const result = await service(db).writePurchaseReturn(
            EXPRESS,
            { externalId: '1704', returnNumber: 'XR-2600628', referenceNumber: '2600628', externalPurchaseId: null, externalSupplierId: '4300', totalAmount: 13000, dueCredit: 13000, notes: null, returnDate: OPENING, externalUpdatedAt: null, items: [] },
            null,
            'sup-1',
            new Map(),
            new Map([['1704', 'pr-1']]),
            [],
        );

        expect(result).toBe(false);
        expect(db.supplierCreditTransaction.create.mock.calls[0][0].data).toMatchObject({ supplier_id: 'sup-1', type: 'ADJUSTMENT', amount: -13000, reference_id: 'pr-1' });
    });
});

describe('a customer recreated with a phone number that is not one', () => {
    it('is created without the number, which another customer holds', async () => {
        // Press Club: LS Trade International ("415"), whose ERP71 record had been deleted.
        const db = makeDb({ CUSTOMER: [['c-ls', 'gone']] });
        db.customer.updateMany.mockResolvedValue({ count: 0 });
        db.customer.findFirst = jest.fn(async () => null);
        db.customer.create = jest.fn(async () => ({ id: 'cust-new' }));
        const warnings: any[] = [];

        await service(db).syncCustomers(
            CONNECTION,
            { fetchCustomers: jest.fn(async () => [{ Id: 'c-ls', Code: 'C0415', Name: 'LS Trade International', ContactNo: '415', Balance: 9320 }]) },
            emptyStats(),
            warnings,
            false,
            OPENING,
            MAPPERS,
            new Map([['c-ls', 9320]]),
        );

        expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ name: 'LS Trade International', phone: null });
        expect(db.customerCreditTransaction.create.mock.calls[0][0].data).toMatchObject({ customer_id: 'cust-new', amount: 9320 });
        expect(warnings.filter((w) => w.code === 'WRITE_FAILED')).toEqual([]);
    });
});
