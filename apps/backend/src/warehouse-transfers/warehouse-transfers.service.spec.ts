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
        // Call history has to start empty in every case: several of the approval
        // tests assert that NOTHING moved, which a leaked call from the previous
        // test would quietly satisfy in the wrong direction.
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
        // Both warehouses resolve to the same branch by default, so the existing
        // cases stay intra-branch; the cross-branch cases override per call.
        (assertWarehouseBelongsToTenant as jest.Mock).mockResolvedValue({ id: 'wh-1', store_id: 'store-1' });
        (applyInventoryMovement as jest.Mock).mockResolvedValue(5);
        (autoPostFromRules as jest.Mock).mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'FT-00001',
            voucherType: 'fund_transfer',
        });
    });

    it('creates a sent transfer and records outbound inventory movements', async () => {
        tx.product.count.mockResolvedValue(1);
        tx.warehouseTransfer.count.mockResolvedValue(0);
        tx.warehouseTransfer.create.mockResolvedValue({ id: 'transfer-1' });
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

    describe('cross-branch approval', () => {
        /** Source in `store-1`, destination in `store-2`. */
        const acrossBranches = () => {
            (assertWarehouseBelongsToTenant as jest.Mock)
                .mockResolvedValueOnce({ id: 'wh-source', store_id: 'store-1' })
                .mockResolvedValueOnce({ id: 'wh-dest', store_id: 'store-2' });
        };

        beforeEach(() => {
            tx.product.count.mockResolvedValue(1);
            tx.warehouseTransfer.count.mockResolvedValue(0);
            tx.warehouseTransfer.create.mockResolvedValue({ id: 'transfer-1' });
            tx.warehouseTransfer.findFirst.mockResolvedValue({ id: 'transfer-1', items: [] });
        });

        it('derives the branch columns and parks a cross-branch transfer for approval', async () => {
            acrossBranches();

            await service.create('tenant-1', {
                sourceWarehouseId: 'wh-source',
                destinationWarehouseId: 'wh-dest',
                status: 'SENT',
                items: [{ productId: 'prod-1', quantity: 3 }],
            });

            expect(tx.warehouseTransfer.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    source_store_id: 'store-1',
                    destination_store_id: 'store-2',
                    is_cross_branch: true,
                    requires_approval: true,
                    // Asked for SENT, held at PENDING_APPROVAL instead.
                    status: 'PENDING_APPROVAL',
                    sent_at: null,
                }),
                include: expect.any(Object),
            });
        });

        it('moves no stock while a cross-branch transfer awaits approval', async () => {
            acrossBranches();

            await service.create('tenant-1', {
                sourceWarehouseId: 'wh-source',
                destinationWarehouseId: 'wh-dest',
                status: 'SENT',
                items: [{ productId: 'prod-1', quantity: 3 }],
            });

            expect(applyInventoryMovement).not.toHaveBeenCalled();
        });

        it('stamps the branches but requires no approval inside one branch', async () => {
            await service.create('tenant-1', {
                sourceWarehouseId: 'wh-source',
                destinationWarehouseId: 'wh-dest',
                status: 'SENT',
                items: [{ productId: 'prod-1', quantity: 3 }],
            });

            expect(tx.warehouseTransfer.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    source_store_id: 'store-1',
                    destination_store_id: 'store-1',
                    is_cross_branch: false,
                    requires_approval: false,
                    status: 'SENT',
                }),
                include: expect.any(Object),
            });
            expect(applyInventoryMovement).toHaveBeenCalledTimes(1);
        });

        it('sends a draft that needs approval to PENDING_APPROVAL rather than out', async () => {
            tx.warehouseTransfer.findFirst.mockResolvedValue({
                id: 'transfer-1',
                status: 'DRAFT',
                requires_approval: true,
                source_warehouse_id: 'wh-source',
                items: [{ id: 'item-1', product_id: 'prod-1', quantity_sent: 3, note: null }],
            });

            const result = await service.send('tenant-1', 'transfer-1');

            expect(tx.warehouseTransfer.update).toHaveBeenCalledWith({
                where: { id: 'transfer-1' },
                data: { status: 'PENDING_APPROVAL' },
            });
            expect(applyInventoryMovement).not.toHaveBeenCalled();
            expect(autoPostFromRules).not.toHaveBeenCalled();
            expect(result.posting_status).toBeNull();
        });

        it('releases the stock and stamps the approver on approval', async () => {
            tx.warehouseTransfer.findFirst.mockResolvedValue({
                id: 'transfer-1',
                transfer_number: 'TRF-00001',
                status: 'PENDING_APPROVAL',
                is_cross_branch: true,
                source_warehouse_id: 'wh-source',
                source_store_id: 'store-1',
                destination_store_id: 'store-2',
                items: [{ id: 'item-1', product_id: 'prod-1', quantity_sent: 3, note: null, product: { price: 100 } }],
            });

            await service.approve('tenant-1', 'transfer-1', 'user-1');

            expect(tx.warehouseTransfer.update).toHaveBeenCalledWith({
                where: { id: 'transfer-1' },
                data: expect.objectContaining({ approved_by: 'user-1', approval_date: expect.any(Date) }),
            });
            expect(applyInventoryMovement).toHaveBeenCalledWith(
                tx,
                expect.objectContaining({
                    warehouseId: 'wh-source',
                    quantityDelta: -3,
                    movementType: 'TRANSFER_OUT',
                }),
            );
            expect(tx.warehouseTransfer.update).toHaveBeenCalledWith({
                where: { id: 'transfer-1' },
                data: expect.objectContaining({ status: 'SENT' }),
            });
        });

        it('attributes an approved cross-branch transfer to the inter-store scope', async () => {
            tx.warehouseTransfer.findFirst.mockResolvedValue({
                id: 'transfer-1',
                transfer_number: 'TRF-00001',
                status: 'PENDING_APPROVAL',
                is_cross_branch: true,
                source_warehouse_id: 'wh-source',
                source_store_id: 'store-1',
                destination_store_id: 'store-2',
                items: [{ id: 'item-1', product_id: 'prod-1', quantity_sent: 3, note: null, product: { price: 100 } }],
            });

            await service.approve('tenant-1', 'transfer-1', 'user-1');

            expect(autoPostFromRules).toHaveBeenCalledWith(
                expect.objectContaining({
                    conditionValue: 'inter_store',
                    attribution: 'INTER_BRANCH',
                    storeId: 'store-1',
                    counterpartyStoreId: 'store-2',
                }),
            );
        });

        it('rejects with a reason and moves nothing', async () => {
            tx.warehouseTransfer.findFirst.mockResolvedValue({
                id: 'transfer-1',
                status: 'PENDING_APPROVAL',
                items: [{ id: 'item-1', product_id: 'prod-1', quantity_sent: 3, note: null }],
            });

            await service.reject('tenant-1', 'transfer-1', 'user-1', { reason: '  not enough stock here  ' });

            expect(tx.warehouseTransfer.update).toHaveBeenCalledWith({
                where: { id: 'transfer-1' },
                data: expect.objectContaining({
                    status: 'REJECTED',
                    rejected_by: 'user-1',
                    rejection_reason: 'not enough stock here',
                }),
            });
            expect(applyInventoryMovement).not.toHaveBeenCalled();
        });

        it('stores no reason when the approver gave only whitespace', async () => {
            tx.warehouseTransfer.findFirst.mockResolvedValue({
                id: 'transfer-1',
                status: 'PENDING_APPROVAL',
                items: [],
            });

            await service.reject('tenant-1', 'transfer-1', 'user-1', { reason: '   ' });

            expect(tx.warehouseTransfer.update).toHaveBeenCalledWith({
                where: { id: 'transfer-1' },
                data: expect.objectContaining({ rejection_reason: null }),
            });
        });

        it.each(['DRAFT', 'SENT', 'RECEIVED', 'REJECTED'])(
            'refuses to approve a transfer in %s',
            async (status) => {
                tx.warehouseTransfer.findFirst.mockResolvedValue({ id: 'transfer-1', status, items: [] });

                await expect(service.approve('tenant-1', 'transfer-1', 'user-1')).rejects.toThrow(BadRequestException);
                expect(applyInventoryMovement).not.toHaveBeenCalled();
            },
        );

        it('refuses to receive a transfer that is still awaiting approval', async () => {
            tx.warehouseTransfer.findFirst.mockResolvedValue({
                id: 'transfer-1',
                status: 'PENDING_APPROVAL',
                destination_warehouse_id: 'wh-dest',
                items: [{ id: 'item-1', product_id: 'prod-1', quantity_sent: 3, quantity_received: 0, note: null }],
            });

            await expect(
                service.receive('tenant-1', 'transfer-1', { items: [{ productId: 'prod-1', quantityReceived: 1 }] }),
            ).rejects.toThrow(BadRequestException);
            expect(applyInventoryMovement).not.toHaveBeenCalled();
        });

        it('filters the list to cross-branch transfers only', async () => {
            db.warehouseTransfer.findMany.mockResolvedValue([]);

            await service.findAll('tenant-1', { isCrossBranch: true });

            expect(db.warehouseTransfer.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ is_cross_branch: true }),
                }),
            );
        });

        it('keeps the list unfiltered when no scope is asked for', async () => {
            db.warehouseTransfer.findMany.mockResolvedValue([]);

            await service.findAll('tenant-1', {});

            expect(db.warehouseTransfer.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.not.objectContaining({ is_cross_branch: expect.anything() }),
                }),
            );
        });
    });
});
