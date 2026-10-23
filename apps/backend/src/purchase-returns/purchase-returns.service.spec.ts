import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import {
    applyInventoryMovement,
    resolveEntryWarehouses,
    resolveWarehouseId,
    reversalWarehouseResolver,
    usableWarehouseIds,
} from '../database/inventory.utils';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { issueDocumentNumber } from '../database/document-number.utils';

jest.mock('../database/document-number.utils', () => ({
    ...jest.requireActual('../database/document-number.utils'),
    issueDocumentNumber: jest.fn(async () => 'PRET-00001'),
}));

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    resolveWarehouseId: jest.fn(),
    resolveEntryWarehouses: jest.fn(),
    reversalWarehouseResolver: jest.fn(),
    usableWarehouseIds: jest.fn(),
}));

/**
 * The warehouse helpers stubbed to the shape the real ones return, so these
 * tests stay about what the service does with a warehouse rather than about
 * how one is resolved — `inventory.utils.spec.ts` covers that.
 */
function stubWarehouseResolution(defaultWarehouseId = 'wh-1') {
    (resolveWarehouseId as jest.Mock).mockResolvedValue(defaultWarehouseId);
    (resolveEntryWarehouses as jest.Mock).mockImplementation(
        async (_tx: unknown, _tenantId: string, _storeId: string, entryWarehouseId?: string) => {
            const entryId = entryWarehouseId ?? defaultWarehouseId;
            return {
                entryWarehouseId: entryId,
                warehouseIdFor: (lineWarehouseId?: string | null) => lineWarehouseId || entryId,
            };
        },
    );
    (reversalWarehouseResolver as jest.Mock).mockImplementation(
        (_tx: unknown, _tenantId: string, _storeId: string, documentWarehouseId?: string | null) =>
            async (lineWarehouseId?: string | null) =>
                lineWarehouseId ?? documentWarehouseId ?? defaultWarehouseId,
    );
    (usableWarehouseIds as jest.Mock).mockResolvedValue(new Set<string>());
}

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
    voidAutoPostedVoucher: jest.fn(),
    postingIdempotencyKey: jest.requireActual('../accounting/posting.utils').postingIdempotencyKey,
}));

describe('PurchaseReturnsService', () => {
    let service: PurchaseReturnsService;
    let db: any;
    let tx: any;

    beforeEach(async () => {
        jest.clearAllMocks();
        tx = {
            store: {
                findFirst: jest.fn(),
            },
            purchase: {
                findFirst: jest.fn(),
            },
            productStock: {
                updateMany: jest.fn(),
            },
            purchaseReturnItem: {
                createMany: jest.fn(),
                deleteMany: jest.fn(),
            },
            purchaseReturn: {
                count: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                findFirst: jest.fn(),
                delete: jest.fn(),
            },
            supplierCreditTransaction: {
                create: jest.fn(),
                // Read by the unwind an edit or delete starts with.
                findMany: jest.fn().mockResolvedValue([]),
            },
            supplier: {
                update: jest.fn(),
            },
            product: {
                findFirst: jest.fn().mockResolvedValue({ id: 'p-9' }),
            },
            purchaseReturnPayment: {
                deleteMany: jest.fn(),
            },
            // Consulted by an edit to tell an imported return.
            externalSyncMapping: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
            postingEvent: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };

        db = {
            store: {
                findFirst: jest.fn(),
            },
            purchase: {
                findFirst: jest.fn(),
            },
            purchaseReturn: {
                count: jest.fn(),
                create: jest.fn(),
                findMany: jest.fn(),
                findFirst: jest.fn(),
                delete: jest.fn(),
            },
            voucher: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PurchaseReturnsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<PurchaseReturnsService>(PurchaseReturnsService);
        stubWarehouseResolution();
        (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
        (autoPostFromRules as jest.Mock).mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'CR-00001',
            voucherType: 'cash_receive',
        });
    });

    it('creates a purchase return from an existing purchase', async () => {
        tx.store.findFirst.mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' });
        tx.purchase.findFirst.mockResolvedValue({
            id: 'purchase-1',
            tenant_id: 'tenant-1',
            store_id: 'store-1',
            supplier_id: 'sup-1',
            supplier: { id: 'sup-1', due_balance: 100, store_id: 'store-sup' },
            items: [
                { id: 'item-1', product_id: 'prod-1', unit_cost: 12.5, quantity: 4, returnItems: [] },
            ],
        });
        tx.purchaseReturn.count.mockResolvedValue(0);
        tx.productStock.updateMany.mockResolvedValue({ count: 1 });
        tx.purchaseReturn.create.mockResolvedValue({ id: 'pret-1', return_number: 'PRET-00001' });
        tx.purchaseReturn.findFirst.mockResolvedValue({ id: 'pret-1', return_number: 'PRET-00001' });

        const result = await service.create('tenant-1', 'user-1', {
            storeId: 'store-1',
            purchaseId: 'purchase-1',
            items: [{ purchaseItemId: 'item-1', quantity: 2 }],
            referenceNumber: 'REF-1',
        });

        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({
                tenantId: 'tenant-1',
                productId: 'prod-1',
                warehouseId: 'wh-1',
                quantityDelta: -2,
                movementType: 'PURCHASE_RETURN',
                // Regression: referenceId must be the row id, not the PRET- string.
                referenceId: 'pret-1',
            }),
        );
        // Regression: returning payable goods must reduce what we owe the supplier.
        expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    supplier_id: 'sup-1',
                    store_id: 'store-sup',
                    type: 'ADJUSTMENT',
                    amount: -25,
                    balance_after: 75,
                    reference_type: 'PURCHASE_RETURN',
                    reference_id: 'pret-1',
                }),
            }),
        );
        expect(tx.supplier.update).toHaveBeenCalledWith({
            where: { id: 'sup-1' },
            data: { due_balance: 75 },
        });
        expect(tx.purchaseReturnItem.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ return_id: 'pret-1', purchase_item_id: 'item-1', quantity: 2 }),
            ],
        });
        expect(tx.purchaseReturn.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                store_id: 'store-1',
                purchase_id: 'purchase-1',
                supplier_id: 'sup-1',
                return_number: 'PRET-00001',
                reference_number: 'REF-1',
                total_amount: 25,
            }),
        });
        expect(result.id).toBe('pret-1');
        // Numbered at the purchase's branch, against every return number.
        expect(issueDocumentNumber).toHaveBeenCalledWith(tx, expect.objectContaining({
            tenantId: 'tenant-1',
            docType: 'PURCHASE_RETURN',
            storeId: 'store-1',
        }));
        const { isTaken } = (issueDocumentNumber as jest.Mock).mock.calls.at(-1)[1];
        tx.purchaseReturn.findFirst.mockResolvedValueOnce(null);
        await expect(isTaken('PRET-00001')).resolves.toBe(false);
        expect(tx.purchaseReturn.findFirst).toHaveBeenLastCalledWith({
            where: { tenant_id: 'tenant-1', return_number: 'PRET-00001' },
            select: { id: true },
        });
    });

    it('sends the goods back out of the warehouse the purchase received them into', async () => {
        tx.store.findFirst.mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' });
        tx.purchase.findFirst.mockResolvedValue({
            id: 'purchase-1',
            tenant_id: 'tenant-1',
            store_id: 'store-1',
            supplier_id: null,
            supplier: null,
            warehouse_id: 'wh-main',
            items: [
                { id: 'item-1', product_id: 'prod-1', unit_cost: 10, quantity: 4, warehouse_id: null, returnItems: [] },
                { id: 'item-2', product_id: 'prod-2', unit_cost: 10, quantity: 4, warehouse_id: 'wh-annex', returnItems: [] },
            ],
        });
        tx.purchaseReturn.count.mockResolvedValue(0);
        tx.purchaseReturn.create.mockResolvedValue({ id: 'pret-2', return_number: 'PRET-00002' });
        tx.purchaseReturn.findFirst.mockResolvedValue({ id: 'pret-2', return_number: 'PRET-00002' });
        (usableWarehouseIds as jest.Mock).mockResolvedValue(new Set(['wh-main', 'wh-annex']));

        await service.create('tenant-1', 'user-1', {
            storeId: 'store-1',
            purchaseId: 'purchase-1',
            items: [
                { purchaseItemId: 'item-1', quantity: 1 },
                { purchaseItemId: 'item-2', quantity: 1 },
            ],
        });

        expect(tx.purchaseReturn.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ warehouse_id: 'wh-main' }),
            }),
        );
        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({ productId: 'prod-1', warehouseId: 'wh-main', quantityDelta: -1 }),
        );
        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({ productId: 'prod-2', warehouseId: 'wh-annex', quantityDelta: -1 }),
        );
    });

    it('rejects create when purchase item is not part of the source purchase', async () => {
        tx.store.findFirst.mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' });
        tx.purchase.findFirst.mockResolvedValue({
            id: 'purchase-1',
            tenant_id: 'tenant-1',
            store_id: 'store-1',
            items: [],
        });

        await expect(
            service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                purchaseId: 'purchase-1',
                items: [{ purchaseItemId: 'missing-item', quantity: 1 }],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('rejects create when requested quantity exceeds remaining returnable quantity', async () => {
        tx.store.findFirst.mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' });
        tx.purchase.findFirst.mockResolvedValue({
            id: 'purchase-1',
            tenant_id: 'tenant-1',
            store_id: 'store-1',
            items: [
                {
                    id: 'item-1',
                    product_id: 'prod-1',
                    unit_cost: 8,
                    quantity: 5,
                    returnItems: [{ quantity: 3, return_id: 'pret-other' }],
                },
            ],
        });

        await expect(
            service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                purchaseId: 'purchase-1',
                items: [{ purchaseItemId: 'item-1', quantity: 3 }],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('rejects create when stock is insufficient for the return decrement', async () => {
        tx.store.findFirst.mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' });
        tx.purchase.findFirst.mockResolvedValue({
            id: 'purchase-1',
            tenant_id: 'tenant-1',
            store_id: 'store-1',
            items: [
                { id: 'item-1', product_id: 'prod-1', unit_cost: 12.5, quantity: 4, returnItems: [] },
            ],
        });
        tx.purchaseReturn.count.mockResolvedValue(0);
        tx.purchaseReturn.create.mockResolvedValue({ id: 'pret-1', return_number: 'PRET-00001' });
        (applyInventoryMovement as jest.Mock).mockRejectedValueOnce(new BadRequestException('Insufficient stock'));

        await expect(
            service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                purchaseId: 'purchase-1',
                items: [{ purchaseItemId: 'item-1', quantity: 2 }],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('updates a purchase return and replaces line items', async () => {
        tx.purchaseReturn.findFirst.mockResolvedValue({
            id: 'pret-1',
            tenant_id: 'tenant-1',
            purchase: {
                items: [{ id: 'item-1', product_id: 'prod-1', unit_cost: 8, quantity: 6, returnItems: [{ quantity: 2, return_id: 'pret-1' }] }],
            },
            items: [{ id: 'old-item', product_id: 'prod-1', quantity: 2 }],
        });
        (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
        tx.purchaseReturn.findFirst.mockResolvedValueOnce({
            id: 'pret-1',
            tenant_id: 'tenant-1',
            purchase: {
                items: [{ id: 'item-1', product_id: 'prod-1', unit_cost: 8, quantity: 6, returnItems: [{ quantity: 2, return_id: 'pret-1' }] }],
            },
            items: [{ id: 'old-item', product_id: 'prod-1', quantity: 2 }],
        });
        tx.purchaseReturn.findFirst.mockResolvedValueOnce({ id: 'pret-1', total_amount: 24 });

        const result = await service.update('tenant-1', 'pret-1', {
            notes: 'updated',
            items: [{ purchaseItemId: 'item-1', quantity: 3 }],
        });

        expect(applyInventoryMovement).toHaveBeenNthCalledWith(
            1,
            tx,
            expect.objectContaining({ productId: 'prod-1', quantityDelta: 2, movementType: 'PURCHASE_RETURN_REVERSAL' }),
        );
        expect(applyInventoryMovement).toHaveBeenNthCalledWith(
            2,
            tx,
            expect.objectContaining({ productId: 'prod-1', quantityDelta: -3, movementType: 'PURCHASE_RETURN_EDIT' }),
        );
        expect(tx.purchaseReturnItem.deleteMany).toHaveBeenCalledWith({ where: { return_id: 'pret-1' } });
        expect(tx.purchaseReturnItem.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ return_id: 'pret-1', purchase_item_id: 'item-1', quantity: 3 }),
            ],
        });
        expect(tx.purchaseReturn.update).toHaveBeenCalledWith({
            where: { id: 'pret-1' },
            data: expect.objectContaining({
                notes: 'updated',
                total_amount: 24,
            }),
        });
        expect(result.id).toBe('pret-1');
    });

    it('restores stock before deleting a purchase return', async () => {
        tx.purchaseReturn.findFirst.mockResolvedValue({
            id: 'pret-1',
            tenant_id: 'tenant-1',
            items: [{ product_id: 'prod-1', quantity: 2 }],
        });
        tx.purchaseReturn.delete.mockResolvedValue({ id: 'pret-1' });

        await expect(service.remove('tenant-1', 'pret-1')).resolves.toEqual({ deleted: true });

        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({ productId: 'prod-1', quantityDelta: 2, movementType: 'PURCHASE_RETURN_DELETE' }),
        );
        expect(tx.purchaseReturn.delete).toHaveBeenCalledWith({ where: { id: 'pret-1' } });
    });

    it('throws when fetching a missing purchase return', async () => {
        db.purchaseReturn.findFirst.mockResolvedValue(null);

        await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

});

describe('PurchaseReturnsService — returns without a purchase', () => {
    let service: PurchaseReturnsService;
    let tx: any;

    beforeEach(async () => {
        jest.clearAllMocks();
        tx = {
            store: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
            purchase: { findFirst: jest.fn().mockResolvedValue(null) },
            product: { findFirst: jest.fn().mockResolvedValue({ id: 'p-9' }) },
            purchaseReturn: {
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockResolvedValue({ id: 'pret-1', return_number: 'PRET-00001', total_amount: 300, items: [] }),
                findFirst: jest.fn().mockResolvedValue({ id: 'pret-1', return_number: 'PRET-00001', total_amount: 300, items: [] }),
            },
            purchaseReturnItem: { createMany: jest.fn(), deleteMany: jest.fn() },
            supplierCreditTransaction: { create: jest.fn() },
            supplier: { update: jest.fn() },
        };
        const db: any = {
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
            voucher: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
            postingEvent: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const module: TestingModule = await Test.createTestingModule({
            providers: [PurchaseReturnsService, { provide: DatabaseService, useValue: db }],
        }).compile();
        service = module.get<PurchaseReturnsService>(PurchaseReturnsService);
        stubWarehouseResolution();
        (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
        (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted' });
    });

    const line = { productId: 'p-9', quantity: 3, unitCost: 100 };

    it('records a return with no purchase, pricing it from the line', async () => {
        await service.create('t1', 'u1', { storeId: 's1', items: [line] } as any);

        const data = tx.purchaseReturn.create.mock.calls[0][0].data;
        expect(data.purchase_id).toBeNull();
        expect(data.supplier_id).toBeNull();
        expect(data.total_amount).toBe(300);

        // Lines are written separately here, and carry no parent line.
        const rows = tx.purchaseReturnItem.createMany.mock.calls[0][0].data;
        expect(rows[0]).toMatchObject({ purchase_item_id: null, product_id: 'p-9', quantity: 3, line_total: 300 });
    });

    it('requires a product and a cost on each line', async () => {
        await expect(
            service.create('t1', 'u1', { storeId: 's1', items: [{ quantity: 1, unitCost: 5 }] } as any),
        ).rejects.toThrow(/productId is required/);

        await expect(
            service.create('t1', 'u1', { storeId: 's1', items: [{ productId: 'p-9', quantity: 1 }] } as any),
        ).rejects.toThrow(/unitCost is required/);
    });

    it('still rejects a purchase id that does not exist', async () => {
        await expect(
            service.create('t1', 'u1', { storeId: 's1', purchaseId: 'missing', items: [line] } as any),
        ).rejects.toThrow('Purchase not found');
    });
});

describe('PurchaseReturnsService — money received back, edit and delete', () => {
    const actualPosting = jest.requireActual('../accounting/posting.utils');
    const LOCKED = { is_locked: true, period_label: 'October 2026' };
    const NEEDS_SUPPLIER = "Record the full amount received, or pick the supplier's purchase";
    const RECEIVED_ABOVE_TOTAL = 'The amount received is more than the return total.';
    const STORED_ABOVE_TOTAL = 'The amount received is more than the new return total — change it too.';

    // The default rules: the bill is Dr Purchase Payable / Cr Purchases, money
    // back from the supplier Dr Cash in Hand / Cr Purchase Payable. There is no
    // per-mode rule under payment_direction, so an unlinked tender can only
    // fall back to the receive rule's Cash in Hand.
    const RULES: Record<string, { debit_account_id: string; credit_account_id: string }> = {
        'purchase_return:none:null': { debit_account_id: 'payable', credit_account_id: 'purchases' },
        'supplier_payment:payment_direction:receive': { debit_account_id: 'cash-in-hand', credit_account_id: 'payable' },
    };
    const ACCOUNTS: Record<string, string | null> = {
        'cash-in-hand': null,
        'bkash-acct': null,
        'bkash-new': null,
        purchases: null,
        payable: 'SUPPLIER',
    };
    const createdAt = new Date('2026-10-01T06:00:00.000Z');

    let service: PurchaseReturnsService;
    let tx: any;
    let db: any;
    let seq: number;
    let methods: any[];
    /** Posting events by idempotency key, and the vouchers they point at by id. */
    let events: Map<string, any>;
    let vouchers: Map<string, any>;
    let ledger: any[];
    let supplier: { id: string; due_balance: number; store_id: string };
    let purchaseRow: any;
    let returnRow: any;
    let itemRows: any[];
    let paymentRows: any[];
    /** External-sync mapping rows (entity_type, internal_id). */
    let mappings: any[];

    const BILL = ['purchase_return', undefined] as const;
    const RECEIVED = ['supplier_payment', 'received'] as const;
    const voucherOn = ([eventType, legKey]: readonly [string, string | undefined]) => {
        const event = events.get(actualPosting.postingIdempotencyKey('tenant-1', eventType, 'pret-1', legKey));
        return event?.voucher_id ? vouchers.get(event.voucher_id) : undefined;
    };
    /** The live voucher on that leg as [account, debit, credit] rows; undefined when there is none. */
    const voucherRows = (leg: readonly [string, string | undefined]) =>
        voucherOn(leg)?.details.map((d: any) => [d.account_id, Number(d.debit_amount), Number(d.credit_amount)]);
    const partyOn = (leg: readonly [string, string | undefined], accountId: string) =>
        voucherOn(leg)?.details.find((d: any) => d.account_id === accountId)?.party_id ?? null;
    /** What every live voucher has done to the supplier's share of Purchase Payable (debit lowers it). */
    const payableDebitedForSupplier = () =>
        [...vouchers.values()]
            .flatMap((voucher) => voucher.details)
            .filter((d: any) => d.account_id === 'payable' && d.party_id === 'sup-1')
            .reduce((sum: number, d: any) => sum + Number(d.debit_amount) - Number(d.credit_amount), 0);

    const purchaseView = () =>
        purchaseRow && { ...purchaseRow, supplier: purchaseRow.supplier_id ? { ...supplier } : null };

    const cash = (amount: number, extra: Record<string, unknown> = {}) =>
        ({ paymentMethod: 'Cash', paymentMethodId: 'pm-cash', amount, ...extra });
    const bkash = (amount: number, extra: Record<string, unknown> = {}) =>
        ({ paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount, ...extra });

    /** Returns `quantity` of the purchase's one line (100 each), with money back by `payments` when given. */
    const createReturn = (quantity: number, payments?: Record<string, unknown>[]) =>
        service.create('tenant-1', 'user-1', {
            storeId: 'store-1',
            purchaseId: 'pur-1',
            items: [{ purchaseItemId: 'pi-1', quantity }],
            ...(payments && { payments }),
        } as any);
    const lines = (quantity: number) => [{ purchaseItemId: 'pi-1', quantity }];

    beforeEach(async () => {
        jest.clearAllMocks();
        seq = 0;
        events = new Map();
        vouchers = new Map();
        ledger = [];
        itemRows = [];
        paymentRows = [];
        mappings = [];
        returnRow = null;
        supplier = { id: 'sup-1', due_balance: 0, store_id: 'store-sup' };
        purchaseRow = {
            id: 'pur-1',
            tenant_id: 'tenant-1',
            store_id: 'store-1',
            supplier_id: 'sup-1',
            warehouse_id: null,
            items: [{ id: 'pi-1', product_id: 'p-1', quantity: 10, unit_cost: 100, warehouse_id: null, returnItems: [] }],
        };
        methods = [
            { id: 'pm-cash', name: 'Cash', account_id: 'cash-in-hand', all_branches: true, stores: [], sort_order: 1 },
            { id: 'pm-bkash', name: 'bKash', account_id: 'bkash-acct', all_branches: true, stores: [], sort_order: 3 },
        ].map((method) => ({ tenant_id: 'tenant-1', is_active: true, ...method }));

        tx = {
            store: { findFirst: jest.fn().mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' }) },
            purchase: {
                findFirst: jest.fn(async ({ where }: any) => (purchaseRow && where.id === purchaseRow.id ? purchaseView() : null)),
            },
            product: { findFirst: jest.fn().mockResolvedValue({ id: 'p-9' }) },
            purchaseReturn: {
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn(async ({ data }: any) => {
                    returnRow = { id: 'pret-1', tenders_recorded: false, created_at: createdAt, ...data };
                    return { ...returnRow };
                }),
                update: jest.fn(async ({ data }: any) => {
                    Object.assign(returnRow, data);
                    return { ...returnRow };
                }),
                findFirst: jest.fn(async () =>
                    returnRow && {
                        ...returnRow,
                        purchase: returnRow.purchase_id ? purchaseView() : null,
                        supplier: returnRow.supplier_id ? { ...supplier } : null,
                        items: itemRows.map((row) => ({ ...row })),
                        payments: paymentRows.map((row) => ({ ...row })),
                    }),
                delete: jest.fn(async () => {
                    returnRow = null;
                }),
            },
            purchaseReturnItem: {
                createMany: jest.fn(async ({ data }: any) => {
                    itemRows.push(...data.map((row: any) => ({ id: `pri-${++seq}`, ...row })));
                }),
                deleteMany: jest.fn(async () => {
                    itemRows = [];
                }),
            },
            purchaseReturnPayment: {
                createMany: jest.fn(async ({ data }: any) => {
                    paymentRows.push(...data.map((row: any) => ({ id: `prp-${++seq}`, ...row })));
                }),
                deleteMany: jest.fn(async () => {
                    paymentRows = [];
                }),
            },
            supplier: {
                findUnique: jest.fn(async () => ({ ...supplier })),
                update: jest.fn(async ({ data }: any) => {
                    if (data.due_balance !== undefined) supplier.due_balance = Number(data.due_balance);
                    return { ...supplier };
                }),
            },
            supplierCreditTransaction: {
                create: jest.fn(async ({ data }: any) => {
                    ledger.push({ ...data, amount: Number(data.amount), balance_after: Number(data.balance_after) });
                    return data;
                }),
                findMany: jest.fn(async ({ where }: any) =>
                    ledger.filter((row) =>
                        row.tenant_id === where.tenant_id
                        && row.reference_type === where.reference_type
                        && row.reference_id === where.reference_id)),
            },
            // Answers the filters resolveTenders uses the way Postgres would.
            paymentMethod: {
                findMany: jest.fn(async ({ where, orderBy }: any) => {
                    const matched = methods.filter((method) => {
                        if (method.tenant_id !== where.tenant_id) return false;
                        if (where.id?.in && !where.id.in.includes(method.id)) return false;
                        if (where.is_active !== undefined && method.is_active !== where.is_active) return false;
                        if (where.OR && !where.OR.some((c: any) => c.name?.equals?.toLowerCase() === method.name.toLowerCase())) {
                            return false;
                        }
                        return true;
                    });
                    return orderBy ? [...matched].sort((a, b) => a.sort_order - b.sort_order) : matched;
                }),
            },
            // The posting engine's tables, kept as state so a void really
            // removes what a post wrote.
            postingEvent: {
                findUnique: jest.fn(async ({ where }: any) => {
                    const event = events.get(where.tenant_id_idempotency_key.idempotency_key);
                    return event ? { ...event, voucher: event.voucher_id ? vouchers.get(event.voucher_id) ?? null : null } : null;
                }),
                create: jest.fn(async ({ data }: any) => {
                    const event = { id: `pe-${++seq}`, voucher_id: null, ...data };
                    events.set(data.idempotency_key, event);
                    return event;
                }),
                update: jest.fn(async ({ where, data }: any) => {
                    const event = [...events.values()].find((e) => e.id === where.id);
                    if (data.status !== undefined) event.status = data.status;
                    if (data.voucher_id !== undefined) event.voucher_id = data.voucher_id;
                    return event;
                }),
                delete: jest.fn(async ({ where }: any) => {
                    for (const [key, event] of events) if (event.id === where.id) events.delete(key);
                }),
                findFirst: jest.fn(async ({ where }: any) =>
                    [...events.values()].find((event) =>
                        event.tenant_id === where.tenant_id
                        && event.source_module === where.source_module
                        && event.source_type === where.source_type
                        && event.source_id === where.source_id) ?? null),
            },
            externalSyncMapping: {
                findFirst: jest.fn(async ({ where }: any) =>
                    mappings.find((row) =>
                        row.tenant_id === where.tenant_id
                        && row.entity_type === where.entity_type
                        && row.internal_id === where.internal_id) ?? null),
            },
            voucher: {
                create: jest.fn(async ({ data }: any) => {
                    const voucher = {
                        id: `v-${++seq}`,
                        voucher_number: `V-${seq}`,
                        voucher_type: data.voucher_type,
                        date: data.date ?? new Date(),
                        idempotency_key: data.idempotency_key,
                        details: data.details.create,
                    };
                    vouchers.set(voucher.id, voucher);
                    return voucher;
                }),
                delete: jest.fn(async ({ where }: any) => {
                    vouchers.delete(where.id);
                }),
            },
            voucherDetail: { deleteMany: jest.fn() },
            fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
            postingRule: {
                findFirst: jest.fn(async ({ where }: any) =>
                    RULES[`${where.event_type}:${where.condition_key}:${where.condition_value}`] ?? null),
            },
            account: {
                findMany: jest.fn(async ({ where }: any) =>
                    Object.entries(ACCOUNTS)
                        .filter(([id]) => where.id.in.includes(id))
                        .map(([id, party_type]) => ({ id, party_type }))),
            },
            voucherSequence: {
                upsert: jest.fn().mockResolvedValue({ next_number: 1, prefix: 'V' }),
                update: jest.fn().mockResolvedValue({}),
            },
            accountingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        db = {
            $transaction: jest.fn(async (fn: any) => fn(tx)),
            purchaseReturn: {
                findFirst: jest.fn().mockResolvedValue({ id: 'pret-1' }),
                findMany: jest.fn().mockResolvedValue([{ id: 'pret-1' }]),
                count: jest.fn().mockResolvedValue(1),
            },
            postingEvent: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const module: TestingModule = await Test.createTestingModule({
            providers: [PurchaseReturnsService, { provide: DatabaseService, useValue: db }],
        }).compile();
        service = module.get<PurchaseReturnsService>(PurchaseReturnsService);
        stubWarehouseResolution();
        (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
        // The real posting engine, so these tests read the vouchers it writes
        // and the voids it makes.
        (autoPostFromRules as jest.Mock).mockImplementation(actualPosting.autoPostFromRules);
        (voidAutoPostedVoucher as jest.Mock).mockImplementation(actualPosting.voidAutoPostedVoucher);
    });

    it("received split: bill voucher full total + 'received' voucher debiting each tender account", async () => {
        supplier.due_balance = 1000;

        await createReturn(3, [cash(200), bkash(100, { referenceNo: ' TX-1 ' })]);

        // The bill is unchanged: the whole return off the payable.
        expect(voucherRows(BILL)).toEqual([
            ['payable', 300, 0],
            ['purchases', 0, 300],
        ]);
        expect(partyOn(BILL, 'payable')).toBe('sup-1');
        // The money back lands where each method is linked, and goes back on
        // the payable the bill took it off.
        expect(voucherRows(RECEIVED)).toEqual([
            ['cash-in-hand', 200, 0],
            ['bkash-acct', 100, 0],
            ['payable', 0, 300],
        ]);
        expect(partyOn(RECEIVED, 'payable')).toBe('sup-1');
        expect(partyOn(RECEIVED, 'cash-in-hand')).toBeNull();
        expect(vouchers.size).toBe(2);
        expect(paymentRows).toEqual([
            expect.objectContaining({
                return_id: 'pret-1',
                payment_method: 'Cash',
                payment_method_id: 'pm-cash',
                payment_method_name: 'Cash',
                account_id: 'cash-in-hand',
                amount: 200,
                reference_no: null,
            }),
            expect.objectContaining({
                return_id: 'pret-1',
                payment_method: 'Mobile Wallet',
                payment_method_id: 'pm-bkash',
                payment_method_name: 'bKash',
                account_id: 'bkash-acct',
                amount: 100,
                reference_no: 'TX-1',
            }),
        ]);
        expect(returnRow.tenders_recorded).toBe(true);
        // All of it came back as money: the supplier's due does not move.
        expect(ledger).toEqual([]);
        expect(supplier.due_balance).toBe(1000);
        expect(payableDebitedForSupplier()).toBe(0);
    });

    it('due 100, return 300, received 200 → due 0; payable nets to the same', async () => {
        supplier.due_balance = 100;

        await createReturn(3, [cash(200)]);

        expect(ledger).toEqual([
            expect.objectContaining({
                supplier_id: 'sup-1',
                store_id: 'store-sup',
                type: 'ADJUSTMENT',
                amount: -100,
                balance_after: 0,
                reference_type: 'PURCHASE_RETURN',
                reference_id: 'pret-1',
                created_by: 'user-1',
            }),
        ]);
        expect(supplier.due_balance).toBe(0);
        expect(voucherRows(BILL)).toEqual([
            ['payable', 300, 0],
            ['purchases', 0, 300],
        ]);
        expect(voucherRows(RECEIVED)).toEqual([
            ['cash-in-hand', 200, 0],
            ['payable', 0, 200],
        ]);
        // The supplier's share of the payable fell by exactly what its due did.
        expect(payableDebitedForSupplier()).toBe(100);
    });

    it('nothing received, no clamp: due 100, return 300 → due −200', async () => {
        supplier.due_balance = 100;

        await createReturn(3, []);

        // Not clamped to the due: the excess is an advance with the supplier.
        expect(ledger).toEqual([expect.objectContaining({ amount: -300, balance_after: -200 })]);
        expect(supplier.due_balance).toBe(-200);
        expect(voucherRows(BILL)).toEqual([
            ['payable', 300, 0],
            ['purchases', 0, 300],
        ]);
        expect(voucherRows(RECEIVED)).toBeUndefined();
        expect(payableDebitedForSupplier()).toBe(300);
        expect(paymentRows).toEqual([]);
        expect(returnRow.tenders_recorded).toBe(true);
    });

    it('no supplier and partial → 400', async () => {
        purchaseRow.supplier_id = null;
        await expect(createReturn(3, [cash(100)])).rejects.toThrow(new BadRequestException(NEEDS_SUPPLIER));

        // A return with no purchase has no supplier either.
        await expect(
            service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                items: [{ productId: 'p-9', quantity: 1, unitCost: 300 }],
                payments: [cash(100)],
            } as any),
        ).rejects.toThrow(new BadRequestException(NEEDS_SUPPLIER));
    });

    it('no supplier and the whole total received posts both vouchers and touches no ledger', async () => {
        await service.create('tenant-1', 'user-1', {
            storeId: 'store-1',
            items: [{ productId: 'p-9', quantity: 1, unitCost: 300 }],
            payments: [cash(300)],
        } as any);

        expect(voucherRows(BILL)).toEqual([
            ['payable', 300, 0],
            ['purchases', 0, 300],
        ]);
        expect(voucherRows(RECEIVED)).toEqual([
            ['cash-in-hand', 300, 0],
            ['payable', 0, 300],
        ]);
        expect(partyOn(BILL, 'payable')).toBeNull();
        expect(ledger).toEqual([]);
    });

    it('received above total → 400', async () => {
        await expect(createReturn(3, [cash(250), bkash(100)])).rejects.toThrow(
            new BadRequestException(RECEIVED_ABOVE_TOTAL),
        );
    });

    it('a new tender on a method not offered at the branch → 400', async () => {
        methods[1].all_branches = false;
        await expect(createReturn(3, [bkash(300)])).rejects.toThrow(
            new BadRequestException("That payment method isn't available at this branch."),
        );
    });

    it("an unlinked tender debits the receive rule's Cash in Hand", async () => {
        methods[1].account_id = null;

        await createReturn(3, [cash(200), bkash(100)]);

        expect(voucherRows(RECEIVED)).toEqual([
            ['cash-in-hand', 300, 0],
            ['payable', 0, 300],
        ]);
    });

    it("omitted payments = today's posting and clamp", async () => {
        supplier.due_balance = 100;

        await createReturn(3);

        expect(autoPostFromRules).toHaveBeenCalledTimes(1);
        const posting = (autoPostFromRules as jest.Mock).mock.calls[0][0];
        expect(posting).toEqual(expect.objectContaining({
            eventType: 'purchase_return',
            conditionKey: 'none',
            conditionValue: null,
            sourceModule: 'purchases',
            sourceType: 'purchase_return',
            sourceId: 'pret-1',
            amount: 300,
            description: 'Auto-posted purchase return PRET-00001',
            referenceNumber: 'PRET-00001',
            storeId: 'store-1',
            partyType: 'SUPPLIER',
            partyId: 'sup-1',
        }));
        expect(posting.tenderLegs).toBeUndefined();
        expect(posting.legKey).toBeUndefined();
        expect(posting.date).toBeUndefined();
        // Today's clamp: only what the supplier was owed comes off.
        expect(ledger).toEqual([
            expect.objectContaining({ amount: -100, balance_after: 0, notes: 'Purchase return PRET-00001' }),
        ]);
        expect(supplier.due_balance).toBe(0);
        expect(tx.purchaseReturnPayment.createMany).not.toHaveBeenCalled();
        expect(tx.paymentMethod.findMany).not.toHaveBeenCalled();
        expect(returnRow.tenders_recorded).toBe(false);
    });

    it('update re-settles: both vouchers voided and reposted on the return date, opposite ADJUSTMENT written', async () => {
        supplier.due_balance = 1000;
        await createReturn(3, [cash(100)]);
        expect(supplier.due_balance).toBe(800);

        await service.update('tenant-1', 'pret-1', { payments: [bkash(300)] } as any, 'user-2');

        // All of it back as money now: no adjustment, the bill and a bKash receipt.
        expect(voucherRows(BILL)).toEqual([
            ['payable', 300, 0],
            ['purchases', 0, 300],
        ]);
        expect(voucherRows(RECEIVED)).toEqual([
            ['bkash-acct', 300, 0],
            ['payable', 0, 300],
        ]);
        expect(vouchers.size).toBe(2);
        expect(voucherOn(BILL).date).toEqual(createdAt);
        expect(voucherOn(RECEIVED).date).toEqual(createdAt);
        expect(ledger).toEqual([
            expect.objectContaining({ amount: -200, balance_after: 800 }),
            expect.objectContaining({
                type: 'ADJUSTMENT',
                amount: 200,
                balance_after: 1000,
                reference_type: 'PURCHASE_RETURN',
                reference_id: 'pret-1',
                notes: 'Reversed purchase return PRET-00001',
                created_by: 'user-2',
            }),
        ]);
        expect(supplier.due_balance).toBe(1000);
        expect(paymentRows).toEqual([
            expect.objectContaining({ payment_method_id: 'pm-bkash', account_id: 'bkash-acct', amount: 300 }),
        ]);
    });

    it('update of a legacy return unwinds its clamped ADJUSTMENT and voucher', async () => {
        supplier.due_balance = 100;
        await createReturn(3);
        expect(supplier.due_balance).toBe(0);

        await service.update('tenant-1', 'pret-1', { payments: [cash(300)] } as any, 'user-1');

        expect(ledger).toEqual([
            expect.objectContaining({ amount: -100, balance_after: 0 }),
            expect.objectContaining({ amount: 100, balance_after: 100, notes: 'Reversed purchase return PRET-00001' }),
        ]);
        expect(supplier.due_balance).toBe(100);
        expect(voucherRows(BILL)).toEqual([
            ['payable', 300, 0],
            ['purchases', 0, 300],
        ]);
        expect(voucherRows(RECEIVED)).toEqual([
            ['cash-in-hand', 300, 0],
            ['payable', 0, 300],
        ]);
        expect(returnRow.tenders_recorded).toBe(true);
    });

    it('update of a legacy return with new lines and no payments settles it the legacy way again', async () => {
        supplier.due_balance = 100;
        await createReturn(3);

        await service.update('tenant-1', 'pret-1', { items: lines(2) } as any, 'user-1');

        expect(ledger.map((row) => [row.amount, row.balance_after])).toEqual([
            [-100, 0],
            [100, 100],
            [-100, 0],
        ]);
        expect(supplier.due_balance).toBe(0);
        expect(voucherRows(BILL)).toEqual([
            ['payable', 200, 0],
            ['purchases', 0, 200],
        ]);
        expect(voucherRows(RECEIVED)).toBeUndefined();
        expect(returnRow.total_amount).toBe(200);
        expect(returnRow.tenders_recorded).toBe(false);
        expect(paymentRows).toEqual([]);
    });

    it('update with items only keeps the stored payments', async () => {
        supplier.due_balance = 500;
        await createReturn(3, [cash(200), bkash(100, { referenceNo: 'TX-1' })]);
        // bKash has since been linked elsewhere: a kept tender reposts where it was saved.
        methods[1].account_id = 'bkash-new';

        await service.update('tenant-1', 'pret-1', { items: lines(4) } as any, 'user-1');

        // 400 back now: the 300 received as before, the other 100 off the payable.
        expect(voucherRows(BILL)).toEqual([
            ['payable', 400, 0],
            ['purchases', 0, 400],
        ]);
        expect(voucherRows(RECEIVED)).toEqual([
            ['cash-in-hand', 200, 0],
            ['bkash-acct', 100, 0],
            ['payable', 0, 300],
        ]);
        expect(paymentRows).toEqual([
            expect.objectContaining({ payment_method_id: 'pm-cash', account_id: 'cash-in-hand', amount: 200 }),
            expect.objectContaining({ payment_method_id: 'pm-bkash', account_id: 'bkash-acct', amount: 100, reference_no: 'TX-1' }),
        ]);
        expect(supplier.due_balance).toBe(400);
        expect(returnRow.total_amount).toBe(400);
    });

    it('update with items only refuses when the stored payments exceed the new total', async () => {
        await createReturn(3, [cash(300)]);

        await expect(service.update('tenant-1', 'pret-1', { items: lines(2) } as any, 'user-1')).rejects.toThrow(
            new BadRequestException(STORED_ABOVE_TOTAL),
        );
    });

    it('a notes-only update touches nothing', async () => {
        await createReturn(3, [cash(300)]);
        const before = voucherRows(RECEIVED);

        await service.update('tenant-1', 'pret-1', { notes: 'Damaged box', referenceNumber: 'DN-4' } as any, 'user-1');

        expect(returnRow.notes).toBe('Damaged box');
        expect(returnRow.reference_number).toBe('DN-4');
        expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
        expect(voucherRows(RECEIVED)).toEqual(before);
        expect(paymentRows).toHaveLength(1);
    });

    it('re-sending the stored tenders unchanged with new notes writes only the notes', async () => {
        await createReturn(3, [cash(200), bkash(100, { referenceNo: 'TX-1' })]);
        const before = [voucherRows(BILL), voucherRows(RECEIVED)];
        jest.clearAllMocks();

        await service.update(
            'tenant-1',
            'pret-1',
            { notes: 'Wrong size', payments: [cash(200), bkash(100, { referenceNo: 'TX-1' })] } as any,
            'user-1',
        );

        expect(tx.purchaseReturn.update).toHaveBeenCalledTimes(1);
        expect(tx.purchaseReturn.update).toHaveBeenCalledWith({ where: { id: 'pret-1' }, data: { notes: 'Wrong size' } });
        expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
        expect(autoPostFromRules).not.toHaveBeenCalled();
        expect(tx.supplier.update).not.toHaveBeenCalled();
        expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
        expect(tx.purchaseReturnPayment.deleteMany).not.toHaveBeenCalled();
        expect(tx.purchaseReturnPayment.createMany).not.toHaveBeenCalled();
        expect([voucherRows(BILL), voucherRows(RECEIVED)]).toEqual(before);
    });

    it('a corrected reference on the same tenders rewrites the rows, not the books', async () => {
        await createReturn(3, [cash(200), bkash(100, { referenceNo: 'TX-1' })]);
        const before = [voucherRows(BILL), voucherRows(RECEIVED)];
        jest.clearAllMocks();

        await service.update('tenant-1', 'pret-1', { payments: [cash(200), bkash(100, { referenceNo: 'TX-9' })] } as any, 'user-1');

        expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
        expect(autoPostFromRules).not.toHaveBeenCalled();
        expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
        expect(paymentRows).toEqual([
            expect.objectContaining({ payment_method_id: 'pm-cash', account_id: 'cash-in-hand', amount: 200, reference_no: null }),
            expect.objectContaining({ payment_method_id: 'pm-bkash', account_id: 'bkash-acct', amount: 100, reference_no: 'TX-9' }),
        ]);
        expect([voucherRows(BILL), voucherRows(RECEIVED)]).toEqual(before);
    });

    it('a legacy return given an empty receipt is re-settled, not taken for unchanged tenders', async () => {
        supplier.due_balance = 100;
        await createReturn(3);

        await service.update('tenant-1', 'pret-1', { payments: [] } as any, 'user-1');

        // Its missing rows meant "money back unknown", not "nothing came back".
        expect(voidAutoPostedVoucher).toHaveBeenCalled();
        expect(ledger.map((row) => row.amount)).toEqual([-100, 100, -300]);
        expect(supplier.due_balance).toBe(-200);
        expect(returnRow.tenders_recorded).toBe(true);
    });

    describe('the edit screen sends every line back on each save', () => {
        /** Nothing reached the stock, the due or the books. */
        const expectBooksUntouched = () => {
            expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
            expect(autoPostFromRules).not.toHaveBeenCalled();
            expect(applyInventoryMovement).not.toHaveBeenCalled();
            expect(tx.purchaseReturnItem.deleteMany).not.toHaveBeenCalled();
            expect(tx.purchaseReturnItem.createMany).not.toHaveBeenCalled();
            expect(tx.purchaseReturnPayment.deleteMany).not.toHaveBeenCalled();
            expect(tx.purchaseReturnPayment.createMany).not.toHaveBeenCalled();
            expect(tx.supplier.update).not.toHaveBeenCalled();
            expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
        };

        it('the same lines and tenders with new notes write only the notes', async () => {
            supplier.due_balance = 1000;
            await createReturn(3, [cash(200), bkash(100)]);
            const before = [voucherRows(BILL), voucherRows(RECEIVED)];
            jest.clearAllMocks();

            await service.update(
                'tenant-1',
                'pret-1',
                { notes: 'Wrong size', items: lines(3), payments: [cash(200), bkash(100)] } as any,
                'user-1',
            );

            expect(tx.purchaseReturn.update).toHaveBeenCalledTimes(1);
            expect(tx.purchaseReturn.update).toHaveBeenCalledWith({ where: { id: 'pret-1' }, data: { notes: 'Wrong size' } });
            expectBooksUntouched();
            expect([voucherRows(BILL), voucherRows(RECEIVED)]).toEqual(before);
            expect(ledger).toHaveLength(0);
        });

        it('the same lines with new notes go through in a closed period', async () => {
            await createReturn(3, [cash(300)]);
            tx.fiscalPeriod.findFirst.mockResolvedValue(LOCKED);
            jest.clearAllMocks();

            await service.update('tenant-1', 'pret-1', { notes: 'Wrong size', items: lines(3), payments: [cash(300)] } as any, 'user-1');

            expect(returnRow.notes).toBe('Wrong size');
            expectBooksUntouched();
        });

        it('a legacy clamped return re-sent with the same lines and new notes leaves the due alone', async () => {
            // Saved before tenders: the supplier was owed 100, so the clamp took 100 of the 300.
            supplier.due_balance = 100;
            await createReturn(3);
            expect(supplier.due_balance).toBe(0);
            const before = voucherRows(BILL);
            // ৳500 more has been bought on credit since.
            supplier.due_balance = 500;
            jest.clearAllMocks();

            await service.update('tenant-1', 'pret-1', { notes: 'Wrong size', items: lines(3) } as any, 'user-1');

            expect(returnRow.notes).toBe('Wrong size');
            expectBooksUntouched();
            // Re-clamped against today's ৳500 the due would have fallen to ৳300.
            expect(supplier.due_balance).toBe(500);
            expect(ledger).toHaveLength(1);
            expect(voucherRows(BILL)).toEqual(before);
        });

        it('a line sent with the warehouse it already sits in is unchanged', async () => {
            await createReturn(3, [cash(300)]);
            jest.clearAllMocks();

            // Stored with no warehouse of its own, so it sits in the return's (wh-1).
            await service.update(
                'tenant-1',
                'pret-1',
                { notes: 'Wrong size', items: [{ ...lines(3)[0], warehouseId: 'wh-1' }], payments: [cash(300)] } as any,
                'user-1',
            );

            expectBooksUntouched();
        });

        it('a real quantity change still unwinds and re-settles', async () => {
            supplier.due_balance = 1000;
            await createReturn(3, [cash(100)]);
            jest.clearAllMocks();

            await service.update('tenant-1', 'pret-1', { notes: 'Wrong size', items: lines(2), payments: [cash(100)] } as any, 'user-1');

            expect(voidAutoPostedVoucher).toHaveBeenCalled();
            expect(applyInventoryMovement).toHaveBeenCalledWith(
                tx,
                expect.objectContaining({ movementType: 'PURCHASE_RETURN_EDIT', quantityDelta: -2 }),
            );
            expect(voucherRows(BILL)).toEqual([
                ['payable', 200, 0],
                ['purchases', 0, 200],
            ]);
            // 200 back now: 100 received, the other 100 off the payable.
            expect(supplier.due_balance).toBe(900);
            expect(returnRow.total_amount).toBe(200);
            expect(returnRow.notes).toBe('Wrong size');
        });

        it('a line moved to another warehouse is a line edit', async () => {
            await createReturn(3, [cash(300)]);
            jest.clearAllMocks();

            await service.update(
                'tenant-1',
                'pret-1',
                { items: [{ ...lines(3)[0], warehouseId: 'wh-annex' }], payments: [cash(300)] } as any,
                'user-1',
            );

            expect(applyInventoryMovement).toHaveBeenCalledWith(
                tx,
                expect.objectContaining({ movementType: 'PURCHASE_RETURN_EDIT', warehouseId: 'wh-annex', quantityDelta: -3 }),
            );
        });
    });

    it('remove unwinds vouchers and due', async () => {
        supplier.due_balance = 1000;
        await createReturn(3, [cash(100)]);

        await service.remove('tenant-1', 'pret-1', 'user-1');

        expect(vouchers.size).toBe(0);
        expect(events.size).toBe(0);
        expect(ledger.at(-1)).toEqual(expect.objectContaining({
            amount: 200,
            balance_after: 1000,
            reference_id: 'pret-1',
            notes: 'Reversed purchase return PRET-00001',
            created_by: 'user-1',
        }));
        expect(supplier.due_balance).toBe(1000);
        expect(paymentRows).toEqual([]);
        expect(returnRow).toBeNull();
    });

    it('remove of a legacy return reverses its clamped ADJUSTMENT and voids its voucher', async () => {
        supplier.due_balance = 100;
        await createReturn(3);

        await service.remove('tenant-1', 'pret-1', 'user-1');

        expect(vouchers.size).toBe(0);
        expect(events.size).toBe(0);
        expect(ledger.map((row) => [row.amount, row.balance_after])).toEqual([
            [-100, 0],
            [100, 100],
        ]);
        expect(supplier.due_balance).toBe(100);
        expect(returnRow).toBeNull();
    });

    it('a return in a closed fiscal period cannot be edited or deleted', async () => {
        await createReturn(3, [cash(300)]);
        tx.fiscalPeriod.findFirst.mockResolvedValue(LOCKED);
        (applyInventoryMovement as jest.Mock).mockClear();

        await expect(service.update('tenant-1', 'pret-1', { payments: [bkash(300)] } as any, 'user-1')).rejects.toThrow(
            /FISCAL_PERIOD_LOCKED/,
        );
        await expect(service.remove('tenant-1', 'pret-1', 'user-1')).rejects.toThrow(/FISCAL_PERIOD_LOCKED/);
        expect(applyInventoryMovement).not.toHaveBeenCalled();
        expect(voucherRows(RECEIVED)).toEqual([
            ['cash-in-hand', 300, 0],
            ['payable', 0, 300],
        ]);
    });

    it('findOne and findAll include the money-received tenders, in the order they were saved', async () => {
        await service.findOne('tenant-1', 'pret-1');
        await service.findAll('tenant-1');

        expect(db.purchaseReturn.findFirst.mock.calls[0][0].include.payments).toEqual({ orderBy: { created_at: 'asc' } });
        expect(db.purchaseReturn.findMany.mock.calls[0][0].include.payments).toEqual({ orderBy: { created_at: 'asc' } });
    });

    describe('a return external sync imported', () => {
        const IMPORTED = 'This return came from an import — change it in the source system and re-sync.';

        /**
         * The return as the importer leaves it (external-sync.impacts.ts
         * applyPurchaseReturnImpacts with Express's dueCredit): no tender rows,
         * the whole total off the due unclamped (100 owed → −200), the bill
         * posted from 'external-sync', and a mapping row while the connection
         * exists.
         */
        const importReturn = async ({ mapped = true } = {}) => {
            supplier.due_balance = -200;
            returnRow = {
                id: 'pret-1',
                tenant_id: 'tenant-1',
                store_id: 'store-1',
                purchase_id: 'pur-1',
                supplier_id: 'sup-1',
                return_number: 'DZ-PR-7',
                reference_number: null,
                total_amount: 300,
                notes: 'Imported',
                status: 'RECORDED',
                tenders_recorded: false,
                created_at: createdAt,
                warehouse_id: null,
            };
            itemRows = [{ id: 'pri-0', return_id: 'pret-1', purchase_item_id: 'pi-1', product_id: 'p-1', quantity: 3, unit_cost: 100, line_total: 300, warehouse_id: null }];
            ledger.push({
                tenant_id: 'tenant-1',
                supplier_id: 'sup-1',
                store_id: 'store-sup',
                type: 'ADJUSTMENT',
                amount: -300,
                balance_after: -200,
                reference_type: 'PURCHASE_RETURN',
                reference_id: 'pret-1',
                notes: 'Imported purchase return DZ-PR-7',
            });
            await actualPosting.autoPostFromRules({
                tx,
                tenantId: 'tenant-1',
                eventType: 'purchase_return',
                conditionKey: 'none',
                conditionValue: null,
                sourceModule: 'external-sync',
                sourceType: 'purchase_return',
                sourceId: 'pret-1',
                amount: 300,
                description: 'Imported purchase return DZ-PR-7',
                referenceNumber: 'DZ-PR-7',
                date: createdAt,
                storeId: 'store-1',
                partyType: 'SUPPLIER',
                partyId: 'sup-1',
            });
            if (mapped) {
                mappings.push({ tenant_id: 'tenant-1', entity_type: 'PURCHASE_RETURN', external_id: 'dz-7', internal_id: 'pret-1' });
            }
            jest.clearAllMocks();
        };

        const expectUntouched = () => {
            expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
            expect(autoPostFromRules).not.toHaveBeenCalled();
            expect(applyInventoryMovement).not.toHaveBeenCalled();
            expect(tx.purchaseReturn.update).not.toHaveBeenCalled();
            expect(tx.purchaseReturnItem.deleteMany).not.toHaveBeenCalled();
            expect(tx.purchaseReturnPayment.createMany).not.toHaveBeenCalled();
            expect(tx.purchaseReturnPayment.deleteMany).not.toHaveBeenCalled();
            expect(tx.supplier.update).not.toHaveBeenCalled();
            expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
            expect(voucherRows(BILL)).toEqual([
                ['payable', 300, 0],
                ['purchases', 0, 300],
            ]);
            expect(ledger).toHaveLength(1);
            expect(supplier.due_balance).toBe(-200);
        };

        it('an edit to its lines is refused before anything is written', async () => {
            await importReturn();

            await expect(service.update('tenant-1', 'pret-1', { items: lines(2) } as any, 'user-1')).rejects.toThrow(
                new BadRequestException(IMPORTED),
            );
            expectUntouched();
        });

        it('an edit to the money received is refused', async () => {
            await importReturn();

            await expect(service.update('tenant-1', 'pret-1', { payments: [cash(300)] } as any, 'user-1')).rejects.toThrow(
                new BadRequestException(IMPORTED),
            );
            expectUntouched();
        });

        it('is still recognised by its voucher once the connection, and with it the mapping, is gone', async () => {
            await importReturn({ mapped: false });

            await expect(service.update('tenant-1', 'pret-1', { items: lines(2) } as any, 'user-1')).rejects.toThrow(
                new BadRequestException(IMPORTED),
            );
            expectUntouched();
        });

        it('a notes-only edit is allowed', async () => {
            await importReturn();

            await service.update('tenant-1', 'pret-1', { notes: 'Supplier credit note received' } as any, 'user-1');

            expect(returnRow.notes).toBe('Supplier credit note received');
            expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
            expect(ledger).toHaveLength(1);
            expect(voucherRows(BILL)).toEqual([
                ['payable', 300, 0],
                ['purchases', 0, 300],
            ]);
        });

        it('a notes edit that re-sends its lines unchanged is allowed', async () => {
            await importReturn();

            // What the edit screen sends: the lines as they stand, with the new notes.
            await service.update('tenant-1', 'pret-1', { notes: 'Supplier credit note received', items: lines(3) } as any, 'user-1');

            expect(returnRow.notes).toBe('Supplier credit note received');
            expect(tx.purchaseReturn.update).toHaveBeenCalledTimes(1);
            expect(tx.purchaseReturn.update).toHaveBeenCalledWith({
                where: { id: 'pret-1' },
                data: { notes: 'Supplier credit note received' },
            });
            expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
            expect(autoPostFromRules).not.toHaveBeenCalled();
            expect(applyInventoryMovement).not.toHaveBeenCalled();
            expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
            expect(ledger).toHaveLength(1);
            expect(supplier.due_balance).toBe(-200);
            expect(voucherRows(BILL)).toEqual([
                ['payable', 300, 0],
                ['purchases', 0, 300],
            ]);
        });

        it('delete voids its voucher and reverses its ADJUSTMENT exactly', async () => {
            await importReturn();

            await service.remove('tenant-1', 'pret-1', 'user-1');

            expect(vouchers.size).toBe(0);
            expect(events.size).toBe(0);
            expect(ledger).toEqual([
                expect.objectContaining({ amount: -300, balance_after: -200 }),
                expect.objectContaining({
                    type: 'ADJUSTMENT',
                    amount: 300,
                    balance_after: 100,
                    reference_type: 'PURCHASE_RETURN',
                    reference_id: 'pret-1',
                    notes: 'Reversed purchase return DZ-PR-7',
                }),
            ]);
            expect(supplier.due_balance).toBe(100);
            expect(returnRow).toBeNull();
        });
    });
});
