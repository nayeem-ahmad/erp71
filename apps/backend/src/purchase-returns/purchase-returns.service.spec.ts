import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    resolveWarehouseId: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
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
            },
            supplier: {
                update: jest.fn(),
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
        (resolveWarehouseId as jest.Mock).mockResolvedValue('wh-1');
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
            supplier: { id: 'sup-1', due_balance: 100 },
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