import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PurchasesService } from './purchases.service';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { costBehaviourFor } from '../database/product-cost.utils';

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    resolveWarehouseId: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
    voidAutoPostedVoucher: jest.fn(),
}));

describe('PurchasesService', () => {
    let service: PurchasesService;
    let db: any;
    let tx: any;

    beforeEach(async () => {
        // The module-level jest.mock factories are shared across tests, so their
        // call counts accumulate unless cleared. Implementations survive
        // clearAllMocks; only calls/results are dropped.
        jest.clearAllMocks();

        tx = {
            supplier: {
                findUnique: jest.fn(),
                create: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
            supplierCreditTransaction: {
                create: jest.fn(),
            },
            purchase: {
                count: jest.fn(),
                create: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
            purchaseItem: {
                create: jest.fn(),
            },
            inventoryMovement: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            productStock: {
                upsert: jest.fn(),
            },
        };

        db = {
            store: {
                findFirst: jest.fn(),
            },
            product: {
                findMany: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
            purchase: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
            },
            voucher: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PurchasesService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<PurchasesService>(PurchasesService);
        (resolveWarehouseId as jest.Mock).mockResolvedValue('wh-1');
        (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
        (voidAutoPostedVoucher as jest.Mock).mockResolvedValue(undefined);
        (autoPostFromRules as jest.Mock).mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'CP-00001',
            voucherType: 'cash_payment',
        });
    });

    it('creates a purchase, persists line items, and increments stock atomically', async () => {
        db.store.findFirst.mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' });
        db.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
        tx.purchase.count.mockResolvedValue(0);
        tx.purchase.create.mockResolvedValue({ id: 'purchase-1' });
        tx.purchase.findFirst.mockResolvedValue({ id: 'purchase-1', items: [] });

        const result = await service.create('tenant-1', 'user-1', {
            storeId: 'store-1',
            items: [{ productId: 'prod-1', quantity: 4, unitCost: 8.5 }],
            taxAmount: 2,
            freightAmount: 3,
            discountAmount: 1,
        });

        expect(tx.purchase.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                store_id: 'store-1',
                purchase_number: 'PUR-00001',
                subtotal_amount: 34,
                total_amount: 38,
            }),
        });
        expect(tx.purchaseItem.create).toHaveBeenCalledWith({
            data: {
                purchase_id: 'purchase-1',
                product_id: 'prod-1',
                quantity: 4,
                unit_cost: 8.5,
                line_total: 34,
            },
        });
        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({
                tenantId: 'tenant-1',
                productId: 'prod-1',
                warehouseId: 'wh-1',
                quantityDelta: 4,
                movementType: 'PURCHASE_RECEIPT',
                referenceType: 'PURCHASE',
                referenceId: 'purchase-1',
                // 34.00 of goods plus 3.00 freight over 4 units. The bill line
                // still says 8.50 above; only the cost pool sees the landed
                // figure. This assertion previously read 8.50 and was pinning
                // the bug where freight never reached avg_cost.
                unitCost: 9.25,
            }),
        );
        expect(tx.purchase.findFirst).toHaveBeenCalledWith({
            where: { id: 'purchase-1', tenant_id: 'tenant-1' },
            include: {
                supplier: true,
                items: {
                    include: { product: true, returnItems: true },
                },
            },
        });
        expect(result.id).toBe('purchase-1');
    });

    it('creates a supplier inline when newSupplier payload is provided', async () => {
        db.store.findFirst.mockResolvedValue({ id: 'store-1' });
        db.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
        tx.supplier.findUnique.mockResolvedValue(null);
        tx.supplier.create.mockResolvedValue({ id: 'sup-1' });
        tx.supplier.findFirst.mockResolvedValue({ due_balance: 0 });
        tx.purchase.count.mockResolvedValue(2);
        tx.purchase.create.mockResolvedValue({ id: 'purchase-2' });
        tx.purchase.findFirst.mockResolvedValue({ id: 'purchase-2', supplier_id: 'sup-1' });

        await service.create('tenant-1', 'user-1', {
            storeId: 'store-1',
            newSupplier: { name: 'Fresh Farms', phone: '01700000000' },
            items: [{ productId: 'prod-1', quantity: 1, unitCost: 5 }],
        });

        expect(tx.supplier.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenant_id: 'tenant-1', name: 'Fresh Farms' }),
        });
        expect(tx.purchase.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ supplier_id: 'sup-1' }),
        });
        expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                supplier_id: 'sup-1',
                type: 'CREDIT_PURCHASE',
                amount: 5,
                balance_after: 5,
                reference_type: 'PURCHASE',
                reference_id: 'purchase-2',
            }),
        });
        expect(tx.supplier.update).toHaveBeenCalledWith({
            where: { id: 'sup-1' },
            data: { due_balance: 5 },
        });
    });

    it('rejects purchase creation when a requested product is missing', async () => {
        db.store.findFirst.mockResolvedValue({ id: 'store-1' });
        db.product.findMany.mockResolvedValue([]);

        await expect(
            service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                items: [{ productId: 'missing', quantity: 1, unitCost: 1 }],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('throws when fetching a missing purchase', async () => {
        db.purchase.findFirst.mockResolvedValue(null);

        await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('filters created_at to the inclusive Dhaka day range', async () => {
        db.purchase.findMany.mockResolvedValue([]);
        db.purchase.count = jest.fn().mockResolvedValue(0);
        db.voucher.findMany.mockResolvedValue([]);

        await service.findAll('tenant-1', 1, 20, { timezone: 'Asia/Dhaka',
            createdFrom: '2026-08-19',
            createdTo: '2026-08-19',
        });

        expect(db.purchase.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    created_at: {
                        gte: new Date('2026-08-18T18:00:00.000Z'),
                        lte: new Date('2026-08-19T17:59:59.999Z'),
                    },
                }),
            }),
        );
    });

    describe('landed cost', () => {
        // The suite's outer beforeEach does not clear mocks, so
        // applyInventoryMovement accumulates calls across tests. The existing
        // tests use toHaveBeenCalledWith and do not notice; these read the whole
        // call list and do, so they clear it first.
        beforeEach(() => (applyInventoryMovement as jest.Mock).mockClear());

        // The service refuses a purchase whose product lookup returns a
        // different count from the item list, so the fixture has to name
        // exactly the products the test is buying.
        const setup = (...productIds: string[]) => {
            db.store.findFirst.mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' });
            db.product.findMany.mockResolvedValue(productIds.map((id) => ({ id })));
            tx.purchase.count.mockResolvedValue(0);
            tx.purchase.create.mockResolvedValue({ id: 'purchase-1' });
            tx.purchase.findFirst.mockResolvedValue({ id: 'purchase-1', items: [] });
        };

        const receiptCosts = () =>
            (applyInventoryMovement as jest.Mock).mock.calls.map(([, args]) => [args.productId, args.unitCost]);

        it('spreads freight across lines pro-rata on value', async () => {
            setup('prod-1', 'prod-2');

            await service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                items: [
                    { productId: 'prod-1', quantity: 10, unitCost: 100 },
                    { productId: 'prod-2', quantity: 10, unitCost: 300 },
                ],
                freightAmount: 400,
            });

            // 1000:3000 of goods, so 100 and 300 of the freight.
            expect(receiptCosts()).toEqual([
                ['prod-1', 110],
                ['prod-2', 330],
            ]);
        });

        it('leaves the unit cost alone when there is no freight', async () => {
            setup('prod-1');

            await service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                items: [{ productId: 'prod-1', quantity: 5, unitCost: 20 }],
            });

            expect(receiptCosts()).toEqual([['prod-1', 20]]);
        });

        it('does not capitalise tax or discount', async () => {
            setup('prod-1');

            await service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                items: [{ productId: 'prod-1', quantity: 10, unitCost: 100 }],
                // Local VAT is rebatable and a trade discount is already in the
                // line price. Neither belongs in the cost pool.
                taxAmount: 150,
                discountAmount: 50,
            });

            expect(receiptCosts()).toEqual([['prod-1', 100]]);
        });

        it('still bills the supplier the full amount including freight', async () => {
            setup('prod-1');

            await service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                items: [{ productId: 'prod-1', quantity: 10, unitCost: 100 }],
                freightAmount: 400,
            });

            // The payable is the bill, not the landed cost: allocation changes
            // what inventory is worth, never what is owed.
            expect(tx.purchase.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ subtotal_amount: 1000, freight_amount: 400, total_amount: 1400 }),
            });
        });
    });

    describe('cancel', () => {
        const activePurchase = (overrides: Record<string, unknown> = {}) => ({
            id: 'purchase-1',
            tenant_id: 'tenant-1',
            purchase_number: 'PUR-00001',
            supplier_id: 'sup-1',
            total_amount: 1400,
            status: 'RECORDED',
            items: [{ id: 'line-1', jobCosts: [] }],
            returns: [],
            paymentAllocations: [],
            importShipment: null,
            ...overrides,
        });

        it('reverses the receipt at the cost it came in at, not at today\'s average', async () => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase({ supplier_id: null }));
            tx.inventoryMovement.findMany.mockResolvedValue([
                { product_id: 'prod-1', warehouse_id: 'wh-9', quantity_delta: 10, unit_cost: 140, movement_type: 'PURCHASE_RECEIPT' },
            ]);
            tx.purchase.update.mockResolvedValue({ id: 'purchase-1', status: 'CANCELLED' });

            await service.cancel('tenant-1', 'user-1', 'purchase-1', 'Wrong supplier billed us');

            expect(applyInventoryMovement).toHaveBeenCalledWith(
                tx,
                expect.objectContaining({
                    productId: 'prod-1',
                    // The receipt's own warehouse, not the tenant's current
                    // default — it may have been re-pointed since.
                    warehouseId: 'wh-9',
                    quantityDelta: -10,
                    movementType: 'PURCHASE_CANCELLED',
                    referenceType: 'PURCHASE',
                    referenceId: 'purchase-1',
                    // The landed figure the receipt was stamped with, so the
                    // two sides net to exactly zero in the cost pool.
                    unitCost: 140,
                }),
            );
        });

        it('reverses an imported receipt without disturbing the average it never moved', async () => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase({ supplier_id: null }));
            // external-sync writes `PURCHASE`, which is QUANTITY_ONLY — it
            // never blended a cost into the pool, so its reversal must not pull
            // one out. Filtering the lookup to PURCHASE_RECEIPT would have left
            // an imported bill's stock standing after it was cancelled.
            tx.inventoryMovement.findMany.mockResolvedValue([
                { product_id: 'prod-1', warehouse_id: 'wh-9', quantity_delta: 4, unit_cost: 25, movement_type: 'PURCHASE' },
            ]);
            tx.purchase.update.mockResolvedValue({ id: 'purchase-1', status: 'CANCELLED' });

            await service.cancel('tenant-1', 'user-1', 'purchase-1', 'Imported in error');

            expect(applyInventoryMovement).toHaveBeenCalledWith(
                tx,
                expect.objectContaining({
                    quantityDelta: -4,
                    movementType: 'PURCHASE_CANCELLED_UNCOSTED',
                }),
            );
            expect(costBehaviourFor('PURCHASE_CANCELLED_UNCOSTED')).toBe('QUANTITY_ONLY');
            expect(costBehaviourFor('PURCHASE_CANCELLED')).toBe('REVERSE_RECEIPT');
        });

        it('takes the bill back off the payable and voids the voucher', async () => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase());
            tx.supplier.findFirst.mockResolvedValue({ due_balance: 2000 });
            tx.purchase.update.mockResolvedValue({ id: 'purchase-1', status: 'CANCELLED' });

            await service.cancel('tenant-1', 'user-1', 'purchase-1', 'Goods never arrived');

            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    supplier_id: 'sup-1',
                    // A reversing entry, not a deleted row: the supplier ledger
                    // is a running statement.
                    type: 'ADJUSTMENT',
                    amount: -1400,
                    balance_after: 600,
                    reference_type: 'PURCHASE',
                    reference_id: 'purchase-1',
                    notes: 'Purchase PUR-00001 cancelled: Goods never arrived',
                }),
            });
            expect(tx.supplier.update).toHaveBeenCalledWith({
                where: { id: 'sup-1' },
                data: { due_balance: 600 },
            });
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'purchase', 'purchase-1');
        });

        it('stamps the status, the actor and the note on the document', async () => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase({ supplier_id: null }));
            tx.purchase.update.mockResolvedValue({ id: 'purchase-1', status: 'CANCELLED' });

            await service.cancel('tenant-1', 'user-7', 'purchase-1', 'Duplicate of PUR-00002');

            expect(tx.purchase.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'purchase-1' },
                    data: expect.objectContaining({
                        status: 'CANCELLED',
                        cancelled_by: 'user-7',
                        cancellation_note: 'Duplicate of PUR-00002',
                        cancelled_at: expect.any(Date),
                    }),
                }),
            );
        });

        it('refuses a purchase that is already cancelled, so nothing reverses twice', async () => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase({ status: 'CANCELLED' }));

            await expect(
                service.cancel('tenant-1', 'user-1', 'purchase-1', 'Trying again'),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(applyInventoryMovement).not.toHaveBeenCalled();
            expect(tx.purchase.update).not.toHaveBeenCalled();
        });

        it.each([
            ['returns', { returns: [{ id: 'ret-1' }] }],
            ['allocated supplier payments', { paymentAllocations: [{ id: 'alloc-1' }] }],
            ['an import shipment', { importShipment: { id: 'ship-1' } }],
            ['production job costs', { items: [{ id: 'line-1', jobCosts: [{ id: 'cost-1' }] }] }],
        ])('refuses a purchase that has %s against it', async (_label, overrides) => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase(overrides));

            await expect(
                service.cancel('tenant-1', 'user-1', 'purchase-1', 'Recorded in error'),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(tx.purchase.update).not.toHaveBeenCalled();
            expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
        });

        it('404s an unknown purchase', async () => {
            tx.purchase.findFirst.mockResolvedValue(null);

            await expect(
                service.cancel('tenant-1', 'user-1', 'nope', 'Recorded in error'),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
