import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { InventoryShrinkageService } from './inventory-shrinkage.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    assertWarehouseBelongsToTenant: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
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
            inventoryShrinkage: { count: jest.fn(), create: jest.fn() },
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
        (assertWarehouseBelongsToTenant as jest.Mock).mockResolvedValue({ id: 'wh-1' });
        (applyInventoryMovement as jest.Mock).mockResolvedValue(3);
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
        expect(tx.inventoryShrinkage.count).toHaveBeenCalledWith({
            where: { tenant_id: 'tenant-1', direction: 'FOUND' },
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
});