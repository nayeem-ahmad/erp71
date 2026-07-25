import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { ChatDataService } from './chat-data.service';

const TENANT = 'tenant-1';

function makeDb() {
    const model = (extra: Record<string, jest.Mock> = {}) => ({
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 }, _min: {}, _max: {} }),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        ...extra,
    });

    return {
        product: model(),
        customer: model(),
        supplier: model(),
        store: model(),
        warehouse: model(),
        productGroup: model(),
        brand: model(),
        employee: model(),
        account: model(),
        sale: model(),
        salesReturn: model(),
        purchase: model(),
        purchaseReturn: model(),
        salesOrder: model(),
        purchaseOrder: model(),
        quotation: model(),
        expenseEntry: model(),
        voucher: model(),
        voucherDetail: model(),
        lead: model(),
        deliveryOrder: model(),
        cashierSession: model(),
        attendanceRecord: model(),
        salaryPayment: model(),
        inventoryMovement: model(),
        tenant: model(),
    };
}

async function makeService(db: any) {
    const module: TestingModule = await Test.createTestingModule({
        providers: [ChatDataService, { provide: DatabaseService, useValue: db }],
    }).compile();
    return module.get(ChatDataService);
}

describe('ChatDataService.resolveEntity', () => {
    let db: any;
    let service: ChatDataService;

    beforeEach(async () => {
        db = makeDb();
        service = await makeService(db);
    });

    /**
     * The isolation guarantee for the whole file: every query carries the
     * tenant id the caller was given, and it is never something a model can
     * supply. If this ever regresses, one tenant's names leak into another's
     * assistant.
     */
    it('scopes every entity search to the caller\'s tenant', async () => {
        for (const type of ['product', 'customer', 'supplier', 'branch', 'warehouse', 'category', 'brand', 'employee', 'account'] as const) {
            await service.resolveEntity(TENANT, type, 'anything');
        }

        const calls = [
            db.product, db.customer, db.supplier, db.store,
            db.warehouse, db.productGroup, db.brand, db.employee, db.account,
        ];
        for (const model of calls) {
            expect(model.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT }) }),
            );
        }
    });

    it('returns nothing for a blank query without touching the database', async () => {
        expect(await service.resolveEntity(TENANT, 'product', '   ')).toEqual([]);
        expect(db.product.findMany).not.toHaveBeenCalled();
    });

    it('matches a product on name or sku and reports the sku as detail', async () => {
        db.product.findMany.mockResolvedValue([
            { id: 'p1', name: 'Rice 5kg', sku: 'RICE-5', group: { name: 'Grains' } },
        ]);

        const rows = await service.resolveEntity(TENANT, 'product', 'rice');

        expect(rows).toEqual([{ id: 'p1', label: 'Rice 5kg', detail: 'RICE-5 · Grains' }]);
        const where = db.product.findMany.mock.calls[0][0].where;
        expect(where.OR).toEqual([
            { name: { contains: 'rice', mode: 'insensitive' } },
            { sku: { contains: 'rice', mode: 'insensitive' } },
        ]);
    });

    it('excludes soft-deleted records', async () => {
        await service.resolveEntity(TENANT, 'customer', 'karim');

        expect(db.customer.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ deleted_at: null }) }),
        );
    });

    it('falls back to a customer code when no phone is recorded', async () => {
        db.customer.findMany.mockResolvedValue([{ id: 'c1', name: 'Karim', phone: null, customer_code: 'CUS-9' }]);

        expect(await service.resolveEntity(TENANT, 'customer', 'karim')).toEqual([
            { id: 'c1', label: 'Karim', detail: 'CUS-9' },
        ]);
    });
});

describe('ChatDataService.listDocuments', () => {
    let db: any;
    let service: ChatDataService;

    beforeEach(async () => {
        db = makeDb();
        service = await makeService(db);
    });

    it('normalises an invoice into the shared document shape', async () => {
        db.sale.findMany.mockResolvedValue([
            {
                id: 's1',
                serial_number: 'INV-1',
                reference_number: null,
                total_amount: 1000,
                amount_paid: 400,
                sale_date: new Date('2026-07-20T10:00:00Z'),
                store: { name: 'Gulshan' },
                customer: { name: 'Karim' },
            },
        ]);

        const rows: any = await service.listDocuments(TENANT, { type: 'sale', limit: 10 });

        expect(rows[0]).toEqual({
            id: 's1',
            number: 'INV-1',
            date: '2026-07-20',
            party: 'Karim',
            branch: 'Gulshan',
            amount: 1000,
            outstanding: 600,
            status: 'COMPLETED',
        });
    });

    it('labels an invoice with no customer as a walk-in rather than leaving it blank', async () => {
        db.sale.findMany.mockResolvedValue([
            {
                id: 's1', serial_number: 'INV-1', reference_number: null, total_amount: 100, amount_paid: 100,
                sale_date: new Date('2026-07-20T10:00:00Z'), store: { name: 'Gulshan' }, customer: null,
            },
        ]);

        const rows: any = await service.listDocuments(TENANT, { type: 'sale', limit: 10 });

        expect(rows[0].party).toBe('Walk-in customer');
    });

    /**
     * A bare date upper bound must cover the whole day. Parsed literally it is
     * midnight, so a document created that afternoon would be missing from the
     * very range the user asked about.
     */
    it('extends a bare end date to the end of that day', async () => {
        await service.listDocuments(TENANT, { type: 'sale', from: '2026-07-01', to: '2026-07-31', limit: 10 });

        const where = db.sale.findMany.mock.calls[0][0].where;
        expect(where.sale_date).toEqual({
            gte: new Date('2026-07-01'),
            lte: new Date('2026-07-31T23:59:59.999Z'),
        });
    });

    it('values a voucher by its debit side only, never both sides', async () => {
        db.voucher.findMany.mockResolvedValue([
            {
                id: 'v1',
                voucher_number: 'JV-1',
                voucher_type: 'journal',
                description: 'Adjustment',
                date: new Date('2026-07-20T00:00:00Z'),
                store: null,
                details: [{ debit_amount: 500 }, { debit_amount: 0 }],
            },
        ]);

        const rows: any = await service.listDocuments(TENANT, { type: 'voucher', limit: 10 });

        expect(rows[0].amount).toBe(500);
        expect(rows[0].branch).toBe('Head office');
    });

    it('scopes every document type to the tenant', async () => {
        const types = ['sale', 'sales_return', 'purchase', 'purchase_return', 'sales_order', 'purchase_order', 'quotation', 'expense', 'voucher'] as const;
        for (const type of types) {
            await service.listDocuments(TENANT, { type, limit: 5 });
        }

        for (const model of [db.sale, db.salesReturn, db.purchase, db.purchaseReturn, db.salesOrder, db.purchaseOrder, db.quotation, db.expenseEntry, db.voucher]) {
            expect(model.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT }) }),
            );
        }
    });
});

describe('ChatDataService.getOpenPipeline', () => {
    let db: any;
    let service: ChatDataService;

    beforeEach(async () => {
        db = makeDb();
        service = await makeService(db);
    });

    it('counts and values open purchase orders across the whole set, not just the page', async () => {
        db.purchaseOrder.findMany.mockResolvedValue([
            { id: 'po1', po_number: 'PO-1', status: 'SENT', total_amount: 20000, expected_date: new Date('2026-08-01'), supplier: { name: 'Acme' } },
        ]);
        db.purchaseOrder.aggregate.mockResolvedValue({ _sum: { total_amount: 90000 }, _count: { _all: 7 } });

        const result: any = await service.getOpenPipeline(TENANT, 'purchase_orders', undefined, 1);

        expect(result.openCount).toBe(7);
        expect(result.totalValue).toBe(90000);
        expect(result.rows[0].label).toBe('PO-1 · Acme');
    });

    it('reports what is still owed on open sales orders', async () => {
        db.salesOrder.findMany.mockResolvedValue([]);
        db.salesOrder.aggregate.mockResolvedValue({
            _sum: { total_amount: 5000, amount_paid: 1500 },
            _count: { _all: 2 },
        });

        const result: any = await service.getOpenPipeline(TENANT, 'sales_orders');

        expect(result.totalValue).toBe(5000);
        expect(result.unpaidValue).toBe(3500);
    });

    /**
     * Converted and lost leads are finished work. Including them would make the
     * "open pipeline" grow forever and never mean anything.
     */
    it('excludes finished leads from the open pipeline', async () => {
        await service.getOpenPipeline(TENANT, 'leads');

        const where = db.lead.findMany.mock.calls[0][0].where;
        expect(where.status).toEqual({ notIn: ['CONVERTED', 'LOST'] });
        expect(where.tenant_id).toBe(TENANT);
    });

    it('leaves leads and deliveries without a monetary value rather than inventing zero', async () => {
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', name: 'Walk-in', status: 'NEW', priority: 'HIGH', next_step: 'Call', next_step_date: null, last_contacted_at: null },
        ]);

        const result: any = await service.getOpenPipeline(TENANT, 'leads');

        expect(result.totalValue).toBeNull();
        expect(result.rows[0].amount).toBeNull();
        expect(result.byStatus).toEqual({ NEW: 1 });
    });
});

describe('ChatDataService.getCashPosition', () => {
    let db: any;
    let service: ChatDataService;

    beforeEach(async () => {
        db = makeDb();
        service = await makeService(db);
    });

    it('derives asset balances as debits less credits and splits cash from bank', async () => {
        db.account.findMany.mockResolvedValue([
            { id: 'a1', name: 'Cash in Hand', code: '1001', category: 'cash' },
            { id: 'a2', name: 'City Bank', code: '1002', category: 'bank' },
        ]);
        db.voucherDetail.findMany.mockResolvedValue([
            { account_id: 'a1', debit_amount: 1000, credit_amount: 250 },
            { account_id: 'a2', debit_amount: 5000, credit_amount: 0 },
        ]);

        const result = await service.getCashPosition(TENANT);

        expect(result.totals.cash).toBe(750);
        expect(result.totals.bank).toBe(5000);
        expect(result.totals.all).toBe(5750);
        // Ranked by balance, so the biggest pot reads first.
        expect(result.accounts[0].name).toBe('City Bank');
    });

    it('skips the balance query entirely when there are no cash or bank accounts', async () => {
        db.account.findMany.mockResolvedValue([]);

        const result = await service.getCashPosition(TENANT);

        expect(db.voucherDetail.findMany).not.toHaveBeenCalled();
        expect(result.totals.all).toBe(0);
    });

    it('lists still-open cashier sessions with who opened them', async () => {
        db.account.findMany.mockResolvedValue([]);
        db.cashierSession.findMany.mockResolvedValue([
            {
                id: 'cs1',
                opened_at: new Date('2026-07-25T03:00:00Z'),
                opening_cash: 2000,
                store: { name: 'Gulshan' },
                user: { name: 'Rahim', email: 'r@x.com' },
            },
        ]);

        const result = await service.getCashPosition(TENANT);

        expect(db.cashierSession.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT, status: 'OPEN' }) }),
        );
        expect(result.openCashierSessions[0]).toMatchObject({ branch: 'Gulshan', cashier: 'Rahim', openingCash: 2000 });
    });

    it('confines balances to one branch when a store is given', async () => {
        db.account.findMany.mockResolvedValue([{ id: 'a1', name: 'Cash', code: '1', category: 'cash' }]);

        await service.getCashPosition(TENANT, 'store-1');

        const where = db.voucherDetail.findMany.mock.calls[0][0].where;
        expect(where.voucher).toEqual({ tenant_id: TENANT, store_id: 'store-1' });
    });
});

describe('ChatDataService.getWorkforceSummary', () => {
    it('turns attendance rows into a present rate and names the top earners', async () => {
        const db = makeDb();
        db.employee.count.mockResolvedValue(12);
        db.employee.groupBy.mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 12 } }]);
        db.attendanceRecord.groupBy.mockResolvedValue([
            { status: 'PRESENT', _count: { _all: 180 } },
            { status: 'ABSENT', _count: { _all: 20 } },
        ]);
        db.salaryPayment.aggregate.mockResolvedValue({ _sum: { amount: 240000 }, _count: { _all: 12 } });
        db.salaryPayment.groupBy.mockResolvedValue([{ employee_id: 'e1', _sum: { amount: 30000 } }]);
        db.employee.findMany.mockResolvedValue([{ id: 'e1', name: 'Rahim', designation: { name: 'Manager' } }]);
        const service = await makeService(db);

        const result = await service.getWorkforceSummary(TENANT, '2026-07-01', '2026-07-31');

        expect(result.headcount.active).toBe(12);
        expect(result.attendance.presentRatePct).toBe(90);
        expect(result.payroll.totalPaid).toBe(240000);
        expect(result.payroll.topEarners[0]).toEqual({ employee: 'Rahim', designation: 'Manager', paid: 30000 });
    });

    it('reports a null present rate rather than 0% when nothing was recorded', async () => {
        const db = makeDb();
        const service = await makeService(db);

        const result = await service.getWorkforceSummary(TENANT, '2026-07-01', '2026-07-31');

        expect(result.attendance.presentRatePct).toBeNull();
        expect(result.payroll.topEarners).toEqual([]);
    });
});

describe('ChatDataService.getLoyaltySummary', () => {
    it('prices outstanding points at the tenant\'s redeem rate', async () => {
        const db = makeDb();
        db.customer.aggregate.mockResolvedValue({ _sum: { loyalty_points: 5000 }, _count: { _all: 40 } });
        db.customer.findMany.mockResolvedValue([
            { id: 'c1', name: 'Karim', phone: '017', loyalty_points: 900, total_spent: 50000 },
        ]);
        db.tenant.findUnique.mockResolvedValue({
            loyalty_points_enabled: true,
            loyalty_earn_rate: 1,
            loyalty_redeem_rate: 0.5,
            loyalty_min_redeem: 100,
        });
        const service = await makeService(db);

        const result = await service.getLoyaltySummary(TENANT);

        expect(result.totalPointsOutstanding).toBe(5000);
        expect(result.estimatedRedemptionValue).toBe(2500);
        expect(result.topHolders[0]).toMatchObject({ customer: 'Karim', points: 900 });
    });

    it('leaves the redemption value null when no redeem rate is configured', async () => {
        const db = makeDb();
        db.customer.aggregate.mockResolvedValue({ _sum: { loyalty_points: 100 }, _count: { _all: 1 } });
        db.tenant.findUnique.mockResolvedValue({
            loyalty_points_enabled: false,
            loyalty_earn_rate: 0,
            loyalty_redeem_rate: 0,
            loyalty_min_redeem: 0,
        });
        const service = await makeService(db);

        const result = await service.getLoyaltySummary(TENANT);

        expect(result.estimatedRedemptionValue).toBeNull();
        expect(result.enabled).toBe(false);
    });
});

describe('ChatDataService.getStockMovements', () => {
    it('totals inbound and outbound units over the rows it returned', async () => {
        const db = makeDb();
        db.inventoryMovement.findMany.mockResolvedValue([
            { id: 'm1', movement_type: 'PURCHASE_RECEIPT', quantity_delta: 50, balance_after: 60, unit_cost: 20, note: null, created_at: new Date('2026-07-20T00:00:00Z'), product: { name: 'Rice' }, warehouse: { name: 'Main' } },
            { id: 'm2', movement_type: 'SALE', quantity_delta: -8, balance_after: 52, unit_cost: null, note: null, created_at: new Date('2026-07-21T00:00:00Z'), product: { name: 'Rice' }, warehouse: { name: 'Main' } },
        ]);
        const service = await makeService(db);

        const result = await service.getStockMovements(TENANT, { limit: 50 });

        expect(result.totals).toEqual({ unitsIn: 50, unitsOut: 8, netChange: 42 });
        expect(result.rows[0]).toMatchObject({ type: 'PURCHASE_RECEIPT', quantityDelta: 50, unitCost: 20 });
        expect(result.rows[1].unitCost).toBeNull();
    });
});

describe('ChatDataService.getDataCoverage', () => {
    it('reports the date span of each record type so an empty period can be explained', async () => {
        const db = makeDb();
        db.sale.aggregate.mockResolvedValue({
            _min: { sale_date: new Date('2025-01-05T00:00:00Z') },
            _max: { sale_date: new Date('2026-07-24T00:00:00Z') },
            _count: { _all: 1200 },
        });
        const service = await makeService(db);

        const result = await service.getDataCoverage(TENANT);

        expect(result.sales).toEqual({ count: 1200, earliest: '2025-01-05', latest: '2026-07-24' });
        expect(result.purchases.earliest).toBeNull();
    });
});
