import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PurchasesService } from './purchases.service';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    resolveWarehouseId: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
}));

describe('PurchasesService', () => {
    let service: PurchasesService;
    let db: any;
    let tx: any;

    beforeEach(async () => {
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
            },
            purchaseItem: {
                create: jest.fn(),
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
                unitCost: 8.5,
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
});