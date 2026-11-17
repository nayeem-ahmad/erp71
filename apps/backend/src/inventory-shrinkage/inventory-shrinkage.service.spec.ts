import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { InventoryShrinkageService } from './inventory-shrinkage.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { resolveProductCosts } from '../database/product-cost.utils';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { issueDocumentNumber } from '../database/document-number.utils';

jest.mock('../database/document-number.utils', () => ({
    ...jest.requireActual('../database/document-number.utils'),
    issueDocumentNumber: jest.fn(async (_tx: unknown, { docType }: { docType: string }) => (docType === 'STOCK_FOUND' ? 'FND-00001' : 'SHR-00001')),
}));

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    assertWarehouseBelongsToTenant: jest.fn(),
}));

jest.mock('../database/product-cost.utils', () => ({
    ...jest.requireActual('../database/product-cost.utils'),
    resolveProductCosts: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
    voidAutoPostedVoucher: jest.fn(),
}));

describe('InventoryShrinkageService', () => {
    let service: InventoryShrinkageService;
    let db: any;
    let tx: any;

    beforeEach(async () => {
        // applyInventoryMovement and autoPostFromRules are module mocks, so
        // their call history outlives a test unless it is cleared here. Without
        // this, "was never called" assertions pass on the first test and fail on
        // every one after it.
        jest.clearAllMocks();

        tx = {
            inventoryReason: { findFirst: jest.fn() },
            inventoryShrinkage: {
                count: jest.fn(),
                create: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
            inventoryShrinkageItem: { deleteMany: jest.fn() },
            postingEvent: { findFirst: jest.fn() },
            product: { findMany: jest.fn() },
        };

        db = {
            $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
            inventoryShrinkage: { findMany: jest.fn(), findFirst: jest.fn() },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [InventoryShrinkageService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(InventoryShrinkageService);
        (assertWarehouseBelongsToTenant as jest.Mock).mockResolvedValue({ id: 'wh-1', store_id: 'store-1' });
        (applyInventoryMovement as jest.Mock).mockResolvedValue(3);
        (resolveProductCosts as jest.Mock).mockResolvedValue(new Map([['prod-1', 18]]));
        (autoPostFromRules as jest.Mock).mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'JV-00001',
            voucherType: 'journal',
        });
    });

    it('creates a shrinkage record and posts negative inventory movement', async () => {
        tx.inventoryReason.findFirst.mockResolvedValue({ id: 'reason-1' });
        tx.inventoryShrinkage.count.mockResolvedValue(0);
        tx.product.findMany.mockResolvedValue([{ id: 'prod-1', price: 25 }]);
        tx.inventoryShrinkage.create.mockResolvedValue({
            id: 'shrink-1',
            reference_number: 'SHR-00001',
            items: [{ product_id: 'prod-1', quantity: 2, unit_cost: 25 }],
        });

        const result = await service.create('tenant-1', {
            warehouseId: 'wh-1',
            reasonId: 'reason-1',
            notes: 'Crushed by the forklift in bay 3',
            items: [{ productId: 'prod-1', quantity: 2 }],
        });

        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({
                productId: 'prod-1',
                warehouseId: 'wh-1',
                quantityDelta: -2,
                movementType: 'SHRINKAGE',
            }),
        );
        expect(tx.inventoryReason.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ type: 'SHRINKAGE' }) }),
        );
        expect(result.reference_number).toBe('SHR-00001');
    });

    // The report a shopkeeper reads is valued from this column, so it has to be
    // what the stock cost — not what the product sells for, which is what it
    // used to be and which overstated every write-off by the margin.
    it('snapshots the cost the stock was held at, not the selling price', async () => {
        tx.inventoryReason.findFirst.mockResolvedValue({ id: 'reason-1' });
        tx.product.findMany.mockResolvedValue([{ id: 'prod-1', price: 25 }]);
        tx.inventoryShrinkage.create.mockResolvedValue({
            id: 'shrink-1',
            reference_number: 'SHR-00001',
            items: [{ product_id: 'prod-1', quantity: 2, unit_cost: 18 }],
        });

        await service.create('tenant-1', {
            warehouseId: 'wh-1',
            reasonId: 'reason-1',
            notes: 'Crushed by the forklift in bay 3',
            items: [{ productId: 'prod-1', quantity: 2 }],
        });

        expect(resolveProductCosts).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({ tenantId: 'tenant-1', storeId: 'store-1', productIds: ['prod-1'] }),
        );
        expect(tx.inventoryShrinkage.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    items: { create: [expect.objectContaining({ unit_cost: 18 })] },
                }),
            }),
        );
    });

    // The whole point of the FOUND direction: the same document, the same
    // screen, the opposite sign — and its own reason catalogue and reference
    // series so a surplus can never be read as a write-off.
    it('puts found stock back in, under its own reason type and reference series', async () => {
        tx.inventoryReason.findFirst.mockResolvedValue({ id: 'reason-2', code: 'MISCOUNT' });
        tx.inventoryShrinkage.count.mockResolvedValue(0);
        tx.product.findMany.mockResolvedValue([{ id: 'prod-1', price: 25 }]);
        tx.inventoryShrinkage.create.mockResolvedValue({
            id: 'found-1',
            reference_number: 'FND-00001',
            direction: 'FOUND',
            items: [{ product_id: 'prod-1', quantity: 3, unit_cost: 25 }],
        });

        const result = await service.create('tenant-1', {
            direction: 'FOUND',
            warehouseId: 'wh-1',
            reasonId: 'reason-2',
            notes: 'Two cartons behind the rack, counted with Rahim',
            items: [{ productId: 'prod-1', quantity: 3 }],
        });

        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({
                productId: 'prod-1',
                quantityDelta: 3,
                movementType: 'STOCK_FOUND',
            }),
        );
        expect(tx.inventoryReason.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ type: 'FOUND' }) }),
        );
        // Its own series, checked against both directions' numbers.
        expect(issueDocumentNumber).toHaveBeenCalledWith(tx, expect.objectContaining({
            tenantId: 'tenant-1',
            docType: 'STOCK_FOUND',
            storeId: 'store-1',
        }));
        const { isTaken } = (issueDocumentNumber as jest.Mock).mock.calls.at(-1)[1];
        tx.inventoryShrinkage.findFirst.mockResolvedValueOnce(null);
        await expect(isTaken('FND-00001')).resolves.toBe(false);
        expect(tx.inventoryShrinkage.findFirst).toHaveBeenLastCalledWith({
            where: { tenant_id: 'tenant-1', reference_number: 'FND-00001' },
            select: { id: true },
        });
        expect(tx.inventoryShrinkage.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ direction: 'FOUND', reference_number: 'FND-00001' }),
            }),
        );
        expect(result.reference_number).toBe('FND-00001');
    });

    // A movement that carries its own cost would let anyone with the stock
    // screen restate what inventory is held at. Found goods join at the pool's
    // own average instead, which is what passing no unitCost means.
    it('never stamps a cost of its own on either direction', async () => {
        tx.inventoryReason.findFirst.mockResolvedValue({ id: 'reason-2', code: 'MISCOUNT' });
        tx.inventoryShrinkage.count.mockResolvedValue(0);
        tx.product.findMany.mockResolvedValue([{ id: 'prod-1', price: 25 }]);
        tx.inventoryShrinkage.create.mockResolvedValue({
            id: 'found-1',
            reference_number: 'FND-00001',
            items: [{ product_id: 'prod-1', quantity: 3, unit_cost: 25 }],
        });

        await service.create('tenant-1', {
            direction: 'FOUND',
            warehouseId: 'wh-1',
            reasonId: 'reason-2',
            notes: 'Found during the weekly sweep',
            items: [{ productId: 'prod-1', quantity: 3 }],
        });

        expect((applyInventoryMovement as jest.Mock).mock.calls[0][1].unitCost).toBeUndefined();
    });

    it('refuses a reason belonging to the other direction', async () => {
        // No active FOUND reason with this id — the SHRINKAGE row it names is
        // invisible to the type-scoped lookup.
        tx.inventoryReason.findFirst.mockResolvedValue(null);

        await expect(
            service.create('tenant-1', {
                direction: 'FOUND',
                warehouseId: 'wh-1',
                reasonId: 'shrinkage-reason',
                notes: 'Reason belongs to the other direction',
                items: [{ productId: 'prod-1', quantity: 1 }],
            }),
        ).rejects.toThrow(BadRequestException);
        expect(applyInventoryMovement).not.toHaveBeenCalled();
    });

    it('rejects duplicate product lines', async () => {
        await expect(
            service.create('tenant-1', {
                warehouseId: 'wh-1',
                reasonId: 'reason-1',
                notes: 'Duplicate lines',
                items: [
                    { productId: 'prod-1', quantity: 1 },
                    { productId: 'prod-1', quantity: 2 },
                ],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('throws when a shrinkage record is missing', async () => {
        db.inventoryShrinkage.findFirst.mockResolvedValue(null);
        await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    describe('correcting a posted entry', () => {
        const stored = {
            id: 'shr-1',
            tenant_id: 'tenant-1',
            warehouse_id: 'wh-1',
            reference_number: 'SHR-00001',
            direction: 'LOSS',
            warehouse: { id: 'wh-1', store_id: 'store-1' },
            reason: { id: 'reason-1', code: 'DAMAGE' },
            items: [{ product_id: 'prod-1', quantity: 2 }],
        };

        beforeEach(() => {
            tx.inventoryShrinkage.findFirst.mockResolvedValue(stored);
            tx.inventoryReason.findFirst.mockResolvedValue({ id: 'reason-1', code: 'DAMAGE' });
            tx.product.findMany.mockResolvedValue([{ id: 'prod-1', name: 'Rice 5kg' }]);
            tx.postingEvent.findFirst.mockResolvedValue({
                voucher: { date: new Date('2026-10-01T00:00:00.000Z') },
            });
            tx.inventoryShrinkage.update.mockResolvedValue({
                ...stored,
                items: [{ id: 'item-1', product_id: 'prod-1', quantity: 3, unit_cost: 18 }],
            });
        });

        it('takes the old stock back and applies the corrected lines', async () => {
            await service.update('tenant-1', 'shr-1', {
                reasonId: 'reason-1',
                notes: 'Corrected after the recount',
                items: [{ productId: 'prod-1', quantity: 3 }],
            });

            const deltas = (applyInventoryMovement as jest.Mock).mock.calls.map((call) => ({
                delta: call[1].quantityDelta,
                type: call[1].movementType,
            }));

            // Old line back first, then the corrected one — that order, so a
            // line whose goods partly sold cannot dip below zero mid-correction.
            expect(deltas).toEqual([
                { delta: 2, type: 'SHRINKAGE_REVERSAL' },
                { delta: -3, type: 'SHRINKAGE' },
            ]);
        });

        it('voids the old voucher and re-posts it in its original period', async () => {
            await service.update('tenant-1', 'shr-1', {
                reasonId: 'reason-1',
                notes: 'Corrected after the recount',
                items: [{ productId: 'prod-1', quantity: 3 }],
            });

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'inventory_adjustment', 'shr-1');
            expect(autoPostFromRules).toHaveBeenCalledWith(
                expect.objectContaining({
                    amount: 54,
                    date: new Date('2026-10-01T00:00:00.000Z'),
                }),
            );
        });

        // Direction decides the reference series and the sign of every movement,
        // so it is read off the stored row rather than trusted from the request.
        it('keeps the stored direction even if the caller sends another', async () => {
            await service.update('tenant-1', 'shr-1', {
                direction: 'FOUND',
                reasonId: 'reason-1',
                notes: 'Corrected after the recount',
                items: [{ productId: 'prod-1', quantity: 1 }],
            } as any);

            expect(tx.inventoryReason.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ type: 'SHRINKAGE' }) }),
            );
            expect((applyInventoryMovement as jest.Mock).mock.calls[1][1].quantityDelta).toBe(-1);
        });

        it('refuses a entry that is not there', async () => {
            tx.inventoryShrinkage.findFirst.mockResolvedValue(null);

            await expect(
                service.update('tenant-1', 'missing', {
                    reasonId: 'reason-1',
                    notes: 'Nothing to correct',
                    items: [{ productId: 'prod-1', quantity: 1 }],
                }),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('deleting a posted entry', () => {
        it('returns the stock, voids the voucher, then removes the row', async () => {
            tx.inventoryShrinkage.findFirst.mockResolvedValue({
                id: 'shr-1',
                tenant_id: 'tenant-1',
                warehouse_id: 'wh-1',
                reference_number: 'SHR-00001',
                direction: 'LOSS',
                warehouse: { id: 'wh-1', store_id: 'store-1' },
                items: [{ product_id: 'prod-1', quantity: 4 }],
            });

            await service.remove('tenant-1', 'shr-1');

            expect(applyInventoryMovement).toHaveBeenCalledWith(
                tx,
                expect.objectContaining({
                    quantityDelta: 4,
                    movementType: 'SHRINKAGE_REVERSAL',
                    referenceId: 'SHR-00001',
                }),
            );
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'inventory_adjustment', 'shr-1');
            expect(tx.inventoryShrinkage.delete).toHaveBeenCalledWith({ where: { id: 'shr-1' } });
        });

        // A found surplus that has since sold cannot be taken back out; the
        // guard refuses and the transaction rolls back with the entry intact.
        it('takes a found surplus back out, and refuses when it is no longer there', async () => {
            tx.inventoryShrinkage.findFirst.mockResolvedValue({
                id: 'fnd-1',
                tenant_id: 'tenant-1',
                warehouse_id: 'wh-1',
                reference_number: 'FND-00001',
                direction: 'FOUND',
                warehouse: { id: 'wh-1', store_id: 'store-1' },
                items: [{ product_id: 'prod-1', quantity: 5 }],
            });
            (applyInventoryMovement as jest.Mock).mockRejectedValueOnce(
                new BadRequestException('Insufficient stock for product "Rice 5kg"'),
            );

            await expect(service.remove('tenant-1', 'fnd-1')).rejects.toThrow('Insufficient stock');
            expect(tx.inventoryShrinkage.delete).not.toHaveBeenCalled();
        });
    });
});