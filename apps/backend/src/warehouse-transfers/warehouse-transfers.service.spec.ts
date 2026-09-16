import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { WarehouseTransfersService } from './warehouse-transfers.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    assertWarehouseBelongsToTenant: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
}));

describe('WarehouseTransfersService', () => {
    let service: WarehouseTransfersService;
    let db: any;
    let tx: any;

    beforeEach(async () => {
        // The module-level mocks above are shared across every test in the file,
        // so their call lists have to be emptied between them — otherwise
        // "was not posted" cannot be told apart from "was posted by an earlier
        // test". Implementations are re-set below, after the clear.
        jest.clearAllMocks();

        tx = {
            warehouseTransfer: {
                count: jest.fn(),
                create: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
            warehouseTransferItem: {
                update: jest.fn(),
            },
            product: {
                count: jest.fn(),
            },
        };

        db = {
            $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
            warehouseTransfer: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [WarehouseTransfersService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(WarehouseTransfersService);
        // `Warehouse.store_id` is non-nullable, so a warehouse always names a
        // branch — both of these sit in `store-1` unless a test says otherwise.
        (assertWarehouseBelongsToTenant as jest.Mock).mockImplementation(
            async (_tx: unknown, _tenantId: string, warehouseId: string) => ({ id: warehouseId, store_id: 'store-1' }),
        );
        (applyInventoryMovement as jest.Mock).mockResolvedValue(5);
        (autoPostFromRules as jest.Mock).mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'FT-00001',
            voucherType: 'fund_transfer',
        });
    });

    /**
     * What `tx.warehouseTransfer.create` actually returns: it is always called
     * with `include: transferInclude()`, so the row carries its items (with the
     * product priced) and both warehouse relations.
     */
    const createdTransfer = (overrides: Record<string, any> = {}) => ({
        id: 'transfer-1',
        transfer_number: 'TRF-00001',
        source_store_id: 'store-1',
        destination_store_id: 'store-1',
        is_cross_branch: false,
        sourceWarehouse: { id: 'wh-source', store_id: 'store-1' },
        destinationWarehouse: { id: 'wh-dest', store_id: 'store-1' },
        items: [{ id: 'item-1', product_id: 'prod-1', quantity_sent: 3, quantity_received: 0, note: null, product: { price: 100 } }],
        ...overrides,
    });

    it('creates a sent transfer and records outbound inventory movements', async () => {
        tx.product.count.mockResolvedValue(1);
        tx.warehouseTransfer.count.mockResolvedValue(0);
        tx.warehouseTransfer.create.mockResolvedValue(createdTransfer());
        tx.warehouseTransfer.findFirst.mockResolvedValue({ id: 'transfer-1', items: [] });

        const result = await service.create('tenant-1', {
            sourceWarehouseId: 'wh-source',
            destinationWarehouseId: 'wh-dest',
            status: 'SENT',
            items: [{ productId: 'prod-1', quantity: 3 }],
        });

        expect(tx.warehouseTransfer.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                transfer_number: 'TRF-00001',
                status: 'SENT',
            }),
            include: expect.any(Object),
        });
        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({
                tenantId: 'tenant-1',
                productId: 'prod-1',
                warehouseId: 'wh-source',
                quantityDelta: -3,
                movementType: 'TRANSFER_OUT',
            }),
        );
        expect(result.id).toBe('transfer-1');
    });

    it('records the branch pair on create, and flags a transfer that leaves its branch', async () => {
        (assertWarehouseBelongsToTenant as jest.Mock).mockImplementation(
            async (_tx: unknown, _tenantId: string, warehouseId: string) => ({
                id: warehouseId,
                store_id: warehouseId === 'wh-source' ? 'store-dhaka' : 'store-ctg',
            }),
        );
        tx.product.count.mockResolvedValue(1);
        tx.warehouseTransfer.count.mockResolvedValue(0);
        tx.warehouseTransfer.create.mockResolvedValue(createdTransfer({
            sourceWarehouse: { id: 'wh-source', store_id: 'store-dhaka' },
            destinationWarehouse: { id: 'wh-dest', store_id: 'store-ctg' },
        }));
        tx.warehouseTransfer.findFirst.mockResolvedValue({ id: 'transfer-1', items: [] });

        await service.create('tenant-1', {
            sourceWarehouseId: 'wh-source',
            destinationWarehouseId: 'wh-dest',
            status: 'DRAFT',
            items: [{ productId: 'prod-1', quantity: 3 }],
        });

        expect(tx.warehouseTransfer.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                source_store_id: 'store-dhaka',
                destination_store_id: 'store-ctg',
                is_cross_branch: true,
            }),
            include: expect.any(Object),
        });
    });

    it('records a transfer inside one branch as intra-branch', async () => {
        tx.product.count.mockResolvedValue(1);
        tx.warehouseTransfer.count.mockResolvedValue(0);
        tx.warehouseTransfer.create.mockResolvedValue(createdTransfer());
        tx.warehouseTransfer.findFirst.mockResolvedValue({ id: 'transfer-1', items: [] });

        await service.create('tenant-1', {
            sourceWarehouseId: 'wh-source',
            destinationWarehouseId: 'wh-dest',
            status: 'DRAFT',
            items: [{ productId: 'prod-1', quantity: 3 }],
        });

        expect(tx.warehouseTransfer.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                source_store_id: 'store-1',
                destination_store_id: 'store-1',
                is_cross_branch: false,
            }),
            include: expect.any(Object),
        });
    });

    it('posts a voucher when a transfer is saved straight to SENT, not only when a draft is sent', async () => {
        tx.product.count.mockResolvedValue(1);
        tx.warehouseTransfer.count.mockResolvedValue(0);
        tx.warehouseTransfer.create.mockResolvedValue(createdTransfer());
        tx.warehouseTransfer.findFirst.mockResolvedValue({ id: 'transfer-1', items: [] });

        const result = await service.create('tenant-1', {
            sourceWarehouseId: 'wh-source',
            destinationWarehouseId: 'wh-dest',
            status: 'SENT',
            items: [{ productId: 'prod-1', quantity: 3 }],
        });

        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-1',
                sourceId: 'transfer-1',
                conditionValue: 'intra_store',
                amount: 300,
                storeId: 'store-1',
            }),
        );
        expect(result.voucher_number).toBe('FT-00001');
        expect(result.posting_status).toBe('posted');
    });

    it('leaves a draft unposted', async () => {
        tx.product.count.mockResolvedValue(1);
        tx.warehouseTransfer.count.mockResolvedValue(0);
        tx.warehouseTransfer.create.mockResolvedValue(createdTransfer());
        tx.warehouseTransfer.findFirst.mockResolvedValue({ id: 'transfer-1', items: [] });

        const result = await service.create('tenant-1', {
            sourceWarehouseId: 'wh-source',
            destinationWarehouseId: 'wh-dest',
            status: 'DRAFT',
            items: [{ productId: 'prod-1', quantity: 3 }],
        });

        expect(autoPostFromRules).not.toHaveBeenCalled();
        expect(applyInventoryMovement).not.toHaveBeenCalled();
        expect(result.posting_status).toBeNull();
        expect(result.voucher_number).toBeNull();
    });

    it('posts a cross-branch send as inter-branch even when the stored flag says otherwise', async () => {
        // A draft raised before `create` wrote these columns: nulls and a
        // `false` flag on a transfer whose warehouses sit in different branches.
        const legacyDraft = {
            id: 'transfer-1',
            transfer_number: 'TRF-00001',
            status: 'DRAFT',
            source_warehouse_id: 'wh-source',
            source_store_id: null,
            destination_store_id: null,
            is_cross_branch: false,
            sourceWarehouse: { id: 'wh-source', store_id: 'store-dhaka' },
            destinationWarehouse: { id: 'wh-dest', store_id: 'store-ctg' },
            items: [{ id: 'item-1', product_id: 'prod-1', quantity_sent: 2, quantity_received: 0, note: null, product: { price: 50 } }],
        };
        tx.warehouseTransfer.findFirst
            .mockResolvedValueOnce(legacyDraft)
            .mockResolvedValueOnce({ ...legacyDraft, status: 'SENT' });

        const result = await service.send('tenant-1', 'transfer-1');

        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({
                conditionValue: 'inter_store',
                storeId: 'store-dhaka',
                counterpartyStoreId: 'store-ctg',
                amount: 100,
            }),
        );
        // ...and the row is brought into line with what was posted.
        expect(tx.warehouseTransfer.update).toHaveBeenCalledWith({
            where: { id: 'transfer-1' },
            data: expect.objectContaining({
                status: 'SENT',
                source_store_id: 'store-dhaka',
                destination_store_id: 'store-ctg',
                is_cross_branch: true,
            }),
        });
        expect(result.voucher_number).toBe('FT-00001');
    });

    it('rejects same-warehouse transfers', async () => {
        await expect(
            service.create('tenant-1', {
                sourceWarehouseId: 'wh-1',
                destinationWarehouseId: 'wh-1',
                items: [{ productId: 'prod-1', quantity: 1 }],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('receives a transfer partially and updates received quantities', async () => {
        const transfer = {
            id: 'transfer-1',
            status: 'SENT',
            destination_warehouse_id: 'wh-dest',
            items: [{ id: 'item-1', product_id: 'prod-1', quantity_sent: 5, quantity_received: 1, note: null }],
        };
        tx.warehouseTransfer.findFirst
            .mockResolvedValueOnce(transfer)
            .mockResolvedValueOnce({ ...transfer, items: [{ ...transfer.items[0], quantity_received: 3 }] })
            .mockResolvedValueOnce({ id: 'transfer-1', status: 'PARTIALLY_RECEIVED' });

        await service.receive('tenant-1', 'transfer-1', {
            items: [{ productId: 'prod-1', quantityReceived: 2 }],
        });

        expect(applyInventoryMovement).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({
                warehouseId: 'wh-dest',
                quantityDelta: 2,
                movementType: 'TRANSFER_IN',
            }),
        );
        expect(tx.warehouseTransferItem.update).toHaveBeenCalledWith({
            where: { id: 'item-1' },
            data: expect.objectContaining({ quantity_received: { increment: 2 } }),
        });
        expect(tx.warehouseTransfer.update).toHaveBeenCalledWith({
            where: { id: 'transfer-1' },
            data: expect.objectContaining({ status: 'PARTIALLY_RECEIVED' }),
        });
    });

    it('filters transfers by warehouse, product, status, and date range', async () => {
        db.warehouseTransfer.findMany.mockResolvedValue([]);

        await service.findAll('tenant-1', {
            status: 'SENT',
            sourceWarehouseId: 'wh-source',
            destinationWarehouseId: 'wh-dest',
            productId: 'prod-1',
            from: '2024-01-01',
            to: '2024-01-31',
        });

        expect(db.warehouseTransfer.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    status: 'SENT',
                    source_warehouse_id: 'wh-source',
                    destination_warehouse_id: 'wh-dest',
                    items: { some: { product_id: 'prod-1' } },
                    created_at: {
                        gte: new Date('2023-12-31T18:00:00.000Z'),
                        lte: new Date('2024-01-31T17:59:59.999Z'),
                    },
                }),
            }),
        );
    });
});