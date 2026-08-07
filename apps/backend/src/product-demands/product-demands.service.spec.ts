import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProductDemandsService } from './product-demands.service';
import { assertWarehouseBelongsToTenant } from '../database/inventory.utils';

jest.mock('../database/inventory.utils', () => ({
    assertWarehouseBelongsToTenant: jest.fn(),
}));

describe('ProductDemandsService', () => {
    let service: ProductDemandsService;
    let db: any;
    let tx: any;

    beforeEach(async () => {
        tx = {
            productDemand: {
                findFirst: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            productDemandItem: {
                deleteMany: jest.fn(),
                createMany: jest.fn(),
                update: jest.fn(),
            },
            product: { count: jest.fn() },
        };

        db = {
            $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
            productDemand: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [ProductDemandsService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(ProductDemandsService);
        (assertWarehouseBelongsToTenant as jest.Mock).mockResolvedValue({ id: 'wh-1', is_active: true });
    });

    // ── create ────────────────────────────────────────────────────────────────

    it('creates a draft demand numbered from the highest existing number', async () => {
        tx.product.count.mockResolvedValue(2);
        tx.productDemand.findFirst.mockResolvedValue({ demand_number: 'PD-00007' });
        tx.productDemand.create.mockResolvedValue({ id: 'demand-1' });

        const result = await service.create(
            'tenant-1',
            {
                warehouseId: 'wh-1',
                items: [
                    { productId: 'prod-1', quantity: 5 },
                    { productId: 'prod-2', quantity: 2, note: 'Shelf empty' },
                ],
                priority: 'HIGH',
                neededBy: '2026-09-01',
            },
            { userId: 'user-1', storeId: 'store-1' },
        );

        expect(tx.productDemand.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                store_id: 'store-1',
                warehouse_id: 'wh-1',
                demand_number: 'PD-00008',
                status: 'DRAFT',
                priority: 'HIGH',
                requested_by: 'user-1',
                submitted_at: null,
                needed_by: new Date('2026-09-01'),
            }),
            include: expect.any(Object),
        });
        expect(result.id).toBe('demand-1');
    });

    it('starts numbering at PD-00001 for a tenant with no demands', async () => {
        tx.product.count.mockResolvedValue(1);
        tx.productDemand.findFirst.mockResolvedValue(null);
        tx.productDemand.create.mockResolvedValue({ id: 'demand-1' });

        await service.create('tenant-1', {
            warehouseId: 'wh-1',
            items: [{ productId: 'prod-1', quantity: 1 }],
        });

        expect(tx.productDemand.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ demand_number: 'PD-00001' }),
            include: expect.any(Object),
        });
    });

    it('stamps submitted_at when a demand is created already submitted', async () => {
        tx.product.count.mockResolvedValue(1);
        tx.productDemand.findFirst.mockResolvedValue(null);
        tx.productDemand.create.mockResolvedValue({ id: 'demand-1' });

        await service.create('tenant-1', {
            warehouseId: 'wh-1',
            status: 'SUBMITTED',
            items: [{ productId: 'prod-1', quantity: 1 }],
        });

        expect(tx.productDemand.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ status: 'SUBMITTED', submitted_at: expect.any(Date) }),
            include: expect.any(Object),
        });
    });

    it('rejects duplicate product lines', async () => {
        await expect(
            service.create('tenant-1', {
                warehouseId: 'wh-1',
                items: [
                    { productId: 'prod-1', quantity: 1 },
                    { productId: 'prod-1', quantity: 2 },
                ],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('rejects products belonging to another tenant', async () => {
        tx.product.count.mockResolvedValue(0);
        tx.productDemand.findFirst.mockResolvedValue(null);

        await expect(
            service.create('tenant-1', {
                warehouseId: 'wh-1',
                items: [{ productId: 'prod-other', quantity: 1 }],
            }),
        ).rejects.toThrow(BadRequestException);
        expect(tx.productDemand.create).not.toHaveBeenCalled();
    });

    // ── lifecycle ─────────────────────────────────────────────────────────────

    it('submits a draft demand', async () => {
        db.productDemand.findFirst.mockResolvedValue({
            id: 'demand-1', status: 'DRAFT', requested_by: 'user-1',
            items: [{ id: 'item-1', product_id: 'prod-1', quantity_requested: 3 }],
        });
        db.productDemand.update.mockResolvedValue({ id: 'demand-1', status: 'SUBMITTED' });

        await service.submit('tenant-1', 'demand-1', { userId: 'user-1' });

        expect(db.productDemand.update).toHaveBeenCalledWith({
            where: { id: 'demand-1' },
            data: { status: 'SUBMITTED', submitted_at: expect.any(Date) },
            include: expect.any(Object),
        });
    });

    it('refuses to submit a demand that is not a draft', async () => {
        db.productDemand.findFirst.mockResolvedValue({
            id: 'demand-1', status: 'SUBMITTED', requested_by: 'user-1', items: [],
        });

        await expect(service.submit('tenant-1', 'demand-1', { userId: 'user-1' }))
            .rejects.toThrow(BadRequestException);
    });

    it('refuses to let a second user edit somebody else’s draft', async () => {
        db.productDemand.findFirst.mockResolvedValue({
            id: 'demand-1', status: 'DRAFT', requested_by: 'user-1', items: [],
        });

        await expect(
            service.update('tenant-1', 'demand-1', { priority: 'URGENT' }, { userId: 'user-2' }),
        ).rejects.toThrow(ForbiddenException);
    });

    it('lets the tenant owner edit anyone’s draft', async () => {
        db.productDemand.findFirst.mockResolvedValue({
            id: 'demand-1', status: 'DRAFT', requested_by: 'user-1', items: [],
        });
        tx.productDemand.update.mockResolvedValue({ id: 'demand-1', priority: 'URGENT' });

        await service.update(
            'tenant-1', 'demand-1', { priority: 'URGENT' },
            { userId: 'owner-1', userRole: 'OWNER' },
        );

        expect(tx.productDemand.update).toHaveBeenCalledWith({
            where: { id: 'demand-1' },
            data: expect.objectContaining({ priority: 'URGENT' }),
            include: expect.any(Object),
        });
    });

    it('replaces the lines when a draft is edited', async () => {
        db.productDemand.findFirst.mockResolvedValue({
            id: 'demand-1', status: 'DRAFT', requested_by: 'user-1', items: [],
        });
        tx.product.count.mockResolvedValue(1);
        tx.productDemand.update.mockResolvedValue({ id: 'demand-1' });

        await service.update(
            'tenant-1', 'demand-1',
            { items: [{ productId: 'prod-9', quantity: 4 }] },
            { userId: 'user-1' },
        );

        expect(tx.productDemandItem.deleteMany).toHaveBeenCalledWith({ where: { demand_id: 'demand-1' } });
        expect(tx.productDemandItem.createMany).toHaveBeenCalledWith({
            data: [{ demand_id: 'demand-1', product_id: 'prod-9', quantity_requested: 4, note: null }],
        });
    });

    it('cancels a submitted demand raised by the caller', async () => {
        db.productDemand.findFirst.mockResolvedValue({
            id: 'demand-1', status: 'SUBMITTED', requested_by: 'user-1', items: [],
        });
        db.productDemand.update.mockResolvedValue({ id: 'demand-1', status: 'CANCELLED' });

        await service.cancel('tenant-1', 'demand-1', { userId: 'user-1' });

        expect(db.productDemand.update).toHaveBeenCalledWith({
            where: { id: 'demand-1' },
            data: { status: 'CANCELLED' },
            include: expect.any(Object),
        });
    });

    it('refuses to cancel a demand that has already been approved', async () => {
        db.productDemand.findFirst.mockResolvedValue({
            id: 'demand-1', status: 'APPROVED', requested_by: 'user-1', items: [],
        });

        await expect(service.cancel('tenant-1', 'demand-1', { userId: 'user-1' }))
            .rejects.toThrow(BadRequestException);
    });

    it('404s on a demand belonging to another tenant', async () => {
        db.productDemand.findFirst.mockResolvedValue(null);

        await expect(service.findOne('tenant-1', 'demand-x')).rejects.toThrow(NotFoundException);
    });

    // ── review ────────────────────────────────────────────────────────────────

    const submitted = () => ({
        id: 'demand-1',
        status: 'SUBMITTED',
        requested_by: 'user-1',
        items: [
            { id: 'item-1', product_id: 'prod-1', quantity_requested: 10 },
            { id: 'item-2', product_id: 'prod-2', quantity_requested: 4 },
        ],
    });

    it('approves with a cut quantity and leaves untouched lines at what was asked', async () => {
        db.productDemand.findFirst.mockResolvedValue(submitted());
        tx.productDemand.update.mockResolvedValue({ id: 'demand-1', status: 'APPROVED' });

        await service.review(
            'tenant-1', 'demand-1',
            { status: 'APPROVED', items: [{ productId: 'prod-1', quantityApproved: 6 }], reviewNote: 'Half now' },
            'approver-1',
        );

        expect(tx.productDemandItem.update).toHaveBeenCalledWith({
            where: { id: 'item-1' },
            data: { quantity_approved: 6 },
        });
        expect(tx.productDemandItem.update).toHaveBeenCalledWith({
            where: { id: 'item-2' },
            data: { quantity_approved: 4 },
        });
        expect(tx.productDemand.update).toHaveBeenCalledWith({
            where: { id: 'demand-1' },
            data: expect.objectContaining({
                status: 'APPROVED',
                reviewed_by: 'approver-1',
                review_note: 'Half now',
            }),
            include: expect.any(Object),
        });
    });

    it('zeroes every approved quantity on a rejection', async () => {
        db.productDemand.findFirst.mockResolvedValue(submitted());
        tx.productDemand.update.mockResolvedValue({ id: 'demand-1', status: 'REJECTED' });

        await service.review('tenant-1', 'demand-1', { status: 'REJECTED', reviewNote: 'No budget' }, 'approver-1');

        expect(tx.productDemandItem.update).toHaveBeenCalledWith({
            where: { id: 'item-1' },
            data: { quantity_approved: 0 },
        });
        expect(tx.productDemandItem.update).toHaveBeenCalledWith({
            where: { id: 'item-2' },
            data: { quantity_approved: 0 },
        });
    });

    it('refuses an approved quantity above what was requested', async () => {
        db.productDemand.findFirst.mockResolvedValue(submitted());

        await expect(
            service.review('tenant-1', 'demand-1', {
                status: 'APPROVED',
                items: [{ productId: 'prod-1', quantityApproved: 11 }],
            }),
        ).rejects.toThrow(BadRequestException);
        expect(tx.productDemandItem.update).not.toHaveBeenCalled();
    });

    it('refuses an approval that zeroes every line — that is a rejection', async () => {
        db.productDemand.findFirst.mockResolvedValue(submitted());

        await expect(
            service.review('tenant-1', 'demand-1', {
                status: 'APPROVED',
                items: [
                    { productId: 'prod-1', quantityApproved: 0 },
                    { productId: 'prod-2', quantityApproved: 0 },
                ],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('refuses a reviewed line that is not on the demand', async () => {
        db.productDemand.findFirst.mockResolvedValue(submitted());

        await expect(
            service.review('tenant-1', 'demand-1', {
                status: 'APPROVED',
                items: [{ productId: 'prod-elsewhere', quantityApproved: 1 }],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('refuses to review a demand that was never submitted', async () => {
        db.productDemand.findFirst.mockResolvedValue({ ...submitted(), status: 'DRAFT' });

        await expect(service.review('tenant-1', 'demand-1', { status: 'APPROVED' }))
            .rejects.toThrow(BadRequestException);
    });

    // ── fulfil ────────────────────────────────────────────────────────────────

    it('marks an approved demand fulfilled', async () => {
        db.productDemand.findFirst.mockResolvedValue({ ...submitted(), status: 'APPROVED' });
        db.productDemand.update.mockResolvedValue({ id: 'demand-1', status: 'FULFILLED' });

        await service.fulfil('tenant-1', 'demand-1', { fulfilmentNote: 'TRF-00012' }, 'user-9');

        expect(db.productDemand.update).toHaveBeenCalledWith({
            where: { id: 'demand-1' },
            data: expect.objectContaining({
                status: 'FULFILLED',
                fulfilled_by: 'user-9',
                fulfilment_note: 'TRF-00012',
            }),
            include: expect.any(Object),
        });
    });

    it('refuses to fulfil a demand that is only submitted', async () => {
        db.productDemand.findFirst.mockResolvedValue(submitted());

        await expect(service.fulfil('tenant-1', 'demand-1', {})).rejects.toThrow(BadRequestException);
    });

    // ── list ──────────────────────────────────────────────────────────────────

    it('filters by status, warehouse, priority, product and date range', async () => {
        db.productDemand.findMany.mockResolvedValue([]);

        await service.findAll('tenant-1', {
            status: 'SUBMITTED',
            warehouseId: 'wh-1',
            priority: 'URGENT',
            productId: 'prod-1',
            from: '2026-01-01',
            to: '2026-01-31',
        });

        expect(db.productDemand.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    status: 'SUBMITTED',
                    warehouse_id: 'wh-1',
                    priority: 'URGENT',
                    items: { some: { product_id: 'prod-1' } },
                    created_at: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
                }),
            }),
        );
    });

    it('narrows to the caller’s own demands when mine=true', async () => {
        db.productDemand.findMany.mockResolvedValue([]);

        await service.findAll('tenant-1', { mine: 'true' }, 'user-1');

        expect(db.productDemand.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ requested_by: 'user-1' }),
            }),
        );
    });

    it('matches nothing rather than everything when mine=true has no caller', async () => {
        db.productDemand.findMany.mockResolvedValue([]);

        await service.findAll('tenant-1', { mine: 'true' });

        expect(db.productDemand.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ requested_by: '__no_requester__' }),
            }),
        );
    });
});
