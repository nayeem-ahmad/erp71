import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PurchasesService } from './purchases.service';
import {
    applyInventoryMovement,
    resolveEntryWarehouses,
    resolveWarehouseId,
    reversalWarehouseResolver,
    usableWarehouseIds,
} from '../database/inventory.utils';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { costBehaviourFor } from '../database/product-cost.utils';

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
                // `nextSupplierPaymentNumber` reads the last SPY- row; null
                // means "none yet", so the first counter payment is SPY-00001.
                findFirst: jest.fn().mockResolvedValue(null),
            },
            supplierPaymentAllocation: {
                create: jest.fn(),
                delete: jest.fn(),
            },
            paymentMethod: {
                // No tenant-configured GL account for the method, so the
                // supplier_payment rule's own credit account stands.
                findFirst: jest.fn().mockResolvedValue(null),
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
            purchasePayment: {
                createMany: jest.fn(),
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
        stubWarehouseResolution();
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
                // Null, not 'wh-1': only a line that overrode the bill stores one.
                warehouse_id: null,
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
                payments: true,
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

        expect(tx.supplier.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ tenant_id: 'tenant-1', name: 'Fresh Farms' }),
            }),
        );
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

    it('revives a soft-deleted supplier of that name instead of billing a tombstone', async () => {
        db.store.findFirst.mockResolvedValue({ id: 'store-1' });
        db.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
        // The name is still held by a supplier the shopkeeper deleted, so no
        // new row can be inserted beside it and no list would show the bill's
        // supplier if the purchase were simply pointed at it.
        tx.supplier.findUnique.mockResolvedValue({ id: 'sup-deleted', deleted_at: new Date() });
        tx.supplier.findFirst.mockResolvedValue({ due_balance: 0 });
        tx.purchase.count.mockResolvedValue(2);
        tx.purchase.create.mockResolvedValue({ id: 'purchase-2' });
        tx.purchase.findFirst.mockResolvedValue({ id: 'purchase-2', supplier_id: 'sup-deleted' });

        await service.create('tenant-1', 'user-1', {
            storeId: 'store-1',
            newSupplier: { name: 'Fresh Farms', phone: '01700000000' },
            items: [{ productId: 'prod-1', quantity: 1, unitCost: 5 }],
        });

        expect(tx.supplier.create).not.toHaveBeenCalled();
        expect(tx.supplier.update).toHaveBeenCalledWith({
            where: { id: 'sup-deleted' },
            data: expect.objectContaining({ deleted_at: null, phone: '01700000000' }),
        });
        expect(tx.purchase.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ supplier_id: 'sup-deleted' }),
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

    describe('paying at the counter', () => {
        const cashBill = async (payments: any[], supplierId: string | null = 'sup-1') => {
            db.store.findFirst.mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1' });
            db.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
            tx.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 200 });
            tx.supplierCreditTransaction.create.mockImplementation(async ({ data }: any) => ({ id: 'txn-1', ...data }));
            tx.purchase.count.mockResolvedValue(0);
            tx.purchase.create.mockResolvedValue({ id: 'purchase-1', purchase_number: 'PUR-00001', total_amount: 1000 });
            tx.purchase.findFirst.mockResolvedValue({ id: 'purchase-1', items: [] });

            return service.create('tenant-1', 'user-1', {
                storeId: 'store-1',
                supplierId: supplierId ?? undefined,
                items: [{ productId: 'prod-1', quantity: 10, unitCost: 100 }],
                payments,
            });
        };

        it('books the bill in full and takes the cash straight back off the account', async () => {
            await cashBill([{ paymentMethod: 'Cash', amount: 400 }]);

            // The bill lands part-paid rather than waiting for a separate
            // supplier payment to catch up with it.
            expect(tx.purchase.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ total_amount: 1000, paid_amount: 400, payment_status: 'PARTIAL' }),
            });

            // Two ledger lines, not one net line: the supplier's own books show
            // the invoice and the payment separately, and a net line cannot be
            // reconciled against them. 200 owed before → 1200 → 800.
            expect(tx.supplierCreditTransaction.create).toHaveBeenNthCalledWith(1, {
                data: expect.objectContaining({ type: 'CREDIT_PURCHASE', amount: 1000, balance_after: 1200 }),
            });
            expect(tx.supplierCreditTransaction.create).toHaveBeenNthCalledWith(2, {
                data: expect.objectContaining({
                    type: 'PAYMENT',
                    amount: 400,
                    balance_after: 800,
                    payment_number: 'SPY-00001',
                    reference_type: 'PURCHASE',
                    reference_id: 'purchase-1',
                }),
            });
            expect(tx.supplier.update).toHaveBeenCalledWith({
                where: { id: 'sup-1' },
                data: { due_balance: 800 },
            });

            // `paid_amount` is read back from allocations everywhere else, so an
            // entry payment has to leave one behind.
            expect(tx.supplierPaymentAllocation.create).toHaveBeenCalledWith({
                data: {
                    tenant_id: 'tenant-1',
                    transaction_id: 'txn-1',
                    purchase_id: 'purchase-1',
                    amount: 400,
                },
            });
        });

        it('posts the bill and the cash as two legs, so the payable is raised and then debited', async () => {
            await cashBill([{ paymentMethod: 'Cash', amount: 1000 }]);

            // The bill's own leg stays keyless, so it remains the purchase's
            // primary posting event and the two vouchers cannot collide on one
            // idempotency key.
            const [billLeg] = (autoPostFromRules as jest.Mock).mock.calls[0];
            expect(billLeg).toMatchObject({ eventType: 'purchase', conditionValue: 'credit', amount: 1000 });
            expect(billLeg.legKey).toBeUndefined();
            // Through supplier_payment, the only rule that ever debits Purchase
            // Payable — a bill paid at the counter must not be the one kind of
            // payment that leaves the liability standing.
            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'supplier_payment',
                conditionKey: 'payment_direction',
                conditionValue: 'pay',
                sourceModule: 'purchases',
                sourceType: 'purchase',
                sourceId: 'purchase-1',
                legKey: 'paid',
                amount: 1000,
            }));
        });

        it('sends the cash leg to the account the tenant configured for that method', async () => {
            tx.paymentMethod.findFirst.mockResolvedValue({ account_id: 'acct-bkash' });

            await cashBill([{ paymentMethod: 'Mobile Wallet', amount: 250 }]);

            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'supplier_payment',
                overrideCreditAccountId: 'acct-bkash',
            }));
        });

        it('leaves a bill with no tender exactly as it was before counter payment existed', async () => {
            await cashBill([]);

            expect(tx.purchase.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ paid_amount: 0, payment_status: 'UNPAID' }),
            });
            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledTimes(1);
            expect(tx.supplierPaymentAllocation.create).not.toHaveBeenCalled();
            expect(tx.purchasePayment.createMany).not.toHaveBeenCalled();
            expect(autoPostFromRules).toHaveBeenCalledTimes(1);
        });

        it('ignores a method the user left blank rather than booking a zero payment', async () => {
            await cashBill([{ paymentMethod: 'Cash', amount: 0 }]);

            expect(tx.purchase.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ paid_amount: 0, payment_status: 'UNPAID' }),
            });
            expect(tx.supplierPaymentAllocation.create).not.toHaveBeenCalled();
            expect(tx.purchasePayment.createMany).not.toHaveBeenCalled();
        });

        it('keeps the cheque each tender was paid with, one row per method', async () => {
            await cashBill([
                {
                    paymentMethod: 'Bank',
                    amount: 600,
                    bankName: 'City Bank',
                    bankBranch: ' Gulshan ',
                    bankAccountNumber: '1234567890',
                    referenceNo: 'CHQ-100231',
                    instrumentDate: '2026-10-05',
                },
                { paymentMethod: 'Cash', amount: 400 },
            ]);

            // Trimmed, blank-as-null and UTC-dated exactly as a sale's payment
            // rows are; cash carries no instrument at all.
            expect(tx.purchasePayment.createMany).toHaveBeenCalledWith({
                data: [
                    {
                        purchase_id: 'purchase-1',
                        payment_method: 'Bank',
                        amount: 600,
                        bank_name: 'City Bank',
                        bank_branch: 'Gulshan',
                        bank_account_number: '1234567890',
                        reference_no: 'CHQ-100231',
                        instrument_date: new Date(Date.UTC(2026, 9, 5)),
                    },
                    {
                        purchase_id: 'purchase-1',
                        payment_method: 'Cash',
                        amount: 400,
                        bank_name: null,
                        bank_branch: null,
                        bank_account_number: null,
                        reference_no: null,
                        instrument_date: null,
                    },
                ],
            });
        });

        it('stores only the tenders that carried money, details and all', async () => {
            await cashBill([
                { paymentMethod: 'Cash', amount: 0 },
                { paymentMethod: 'Mobile Wallet', amount: 250, bankAccountNumber: '01711000000', referenceNo: 'TRX9A7' },
            ]);

            expect(tx.purchasePayment.createMany).toHaveBeenCalledWith({
                data: [expect.objectContaining({
                    payment_method: 'Mobile Wallet',
                    amount: 250,
                    bank_account_number: '01711000000',
                    reference_no: 'TRX9A7',
                })],
            });
        });

        it('adds up every tender on the bill', async () => {
            await cashBill([
                { paymentMethod: 'Cash', amount: 600 },
                { paymentMethod: 'Mobile Wallet', amount: 400 },
            ]);

            expect(tx.purchase.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ paid_amount: 1000, payment_status: 'PAID' }),
            });
        });

        it('refuses to pay more than the bill, which would leave an advance this screen cannot record', async () => {
            await expect(
                cashBill([{ paymentMethod: 'Cash', amount: 1200 }]),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(tx.purchase.create).not.toHaveBeenCalled();
        });

        it('records a cash buy with no supplier on the bill itself — there is no account to post it to', async () => {
            await cashBill([{ paymentMethod: 'Cash', amount: 1000 }], null);

            expect(tx.purchase.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ paid_amount: 1000, payment_status: 'PAID' }),
            });
            expect(tx.purchasePayment.createMany).toHaveBeenCalledWith({
                data: [expect.objectContaining({ payment_method: 'Cash', amount: 1000 })],
            });
            expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'supplier_payment',
                amount: 1000,
            }));
        });
    });

    describe('cancel', () => {
        const activePurchase = (overrides: Record<string, unknown> = {}) => ({
            id: 'purchase-1',
            tenant_id: 'tenant-1',
            purchase_number: 'PUR-00001',
            supplier_id: 'sup-1',
            total_amount: 1400,
            paid_amount: 0,
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
            ['allocated supplier payments', {
                paymentAllocations: [{
                    id: 'alloc-1',
                    amount: 500,
                    // A payment recorded on the supplier-payments screen and
                    // applied here afterwards: no reference back to this bill,
                    // so cancelling must not presume to take it back.
                    transaction: {
                        id: 'txn-1',
                        type: 'PAYMENT',
                        amount: 500,
                        payment_number: 'SPY-00001',
                        reference_type: null,
                        reference_id: null,
                    },
                }],
            }],
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

        it('takes back the payment the entry itself recorded, so a cash bill stays cancellable', async () => {
            // A 1400 bill settled with 400 at the counter, leaving 1000 owed —
            // which is all this supplier's balance is.
            tx.purchase.findFirst.mockResolvedValue(activePurchase({
                paid_amount: 400,
                paymentAllocations: [{
                    id: 'alloc-1',
                    amount: 400,
                    transaction: {
                        id: 'txn-1',
                        type: 'PAYMENT',
                        amount: 400,
                        payment_number: 'SPY-00003',
                        reference_type: 'PURCHASE',
                        reference_id: 'purchase-1',
                    },
                }],
            }));
            tx.supplier.findFirst.mockResolvedValue({ due_balance: 1000 });
            tx.purchase.update.mockResolvedValue({ id: 'purchase-1', status: 'CANCELLED' });

            await service.cancel('tenant-1', 'user-1', 'purchase-1', 'Recorded in error');

            // Two reversing lines, in the order the entry wrote them: the bill
            // off the account (1000 → −400), then the cash back on (−400 → 0).
            // Together they undo exactly what create did to this balance.
            expect(tx.supplierCreditTransaction.create).toHaveBeenNthCalledWith(1, {
                data: expect.objectContaining({ type: 'ADJUSTMENT', amount: -1400, balance_after: -400 }),
            });
            expect(tx.supplierCreditTransaction.create).toHaveBeenNthCalledWith(2, {
                data: expect.objectContaining({ type: 'ADJUSTMENT', amount: 400, balance_after: 0 }),
            });
            expect(tx.supplier.update).toHaveBeenCalledWith({
                where: { id: 'sup-1' },
                data: { due_balance: 0 },
            });

            // The allocation goes with the payment — it is what `paid_amount`
            // is read back from — and both vouchers come out.
            expect(tx.supplierPaymentAllocation.delete).toHaveBeenCalledWith({ where: { id: 'alloc-1' } });
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'purchase', 'purchase-1');
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'supplier_payment', 'purchase-1', 'paid');
            expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ paid_amount: 0, payment_status: 'UNPAID' }),
            }));
        });

        it('refuses when its own payment has been part-moved onto another bill', async () => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase({
                paid_amount: 500,
                paymentAllocations: [{
                    id: 'alloc-1',
                    // Half of a 1000 payment; the rest now sits on another
                    // bill, so where that money went is no longer this
                    // method's call to make.
                    amount: 500,
                    transaction: {
                        id: 'txn-1',
                        type: 'PAYMENT',
                        amount: 1000,
                        payment_number: 'SPY-00003',
                        reference_type: 'PURCHASE',
                        reference_id: 'purchase-1',
                    },
                }],
            }));

            await expect(
                service.cancel('tenant-1', 'user-1', 'purchase-1', 'Recorded in error'),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(tx.purchase.update).not.toHaveBeenCalled();
        });

        it('voids the cash leg of a supplier-less bill, which has no ledger row to reverse', async () => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase({ supplier_id: null, paid_amount: 1400 }));
            tx.purchase.update.mockResolvedValue({ id: 'purchase-1', status: 'CANCELLED' });

            await service.cancel('tenant-1', 'user-1', 'purchase-1', 'Recorded in error');

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'supplier_payment', 'purchase-1', 'paid');
            expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ paid_amount: 0, payment_status: 'UNPAID' }),
            }));
        });

        it('leaves an unpaid bill\'s posting alone — there is no cash leg to void', async () => {
            tx.purchase.findFirst.mockResolvedValue(activePurchase({ supplier_id: null }));
            tx.purchase.update.mockResolvedValue({ id: 'purchase-1', status: 'CANCELLED' });

            await service.cancel('tenant-1', 'user-1', 'purchase-1', 'Recorded in error');

            expect(voidAutoPostedVoucher).toHaveBeenCalledTimes(1);
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'purchase', 'purchase-1');
        });

        it('404s an unknown purchase', async () => {
            tx.purchase.findFirst.mockResolvedValue(null);

            await expect(
                service.cancel('tenant-1', 'user-1', 'nope', 'Recorded in error'),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
