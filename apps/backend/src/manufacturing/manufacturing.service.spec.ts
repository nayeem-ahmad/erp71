import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ManufacturingService } from './manufacturing.service';
import { DatabaseService } from '../database/database.service';

describe('ManufacturingService', () => {
    let service: ManufacturingService;
    let db: any;

    const recipe = {
        id: 'recipe-1',
        tenantId: 'tenant-1',
        productId: 'product-out',
        outputQty: 2,
        notes: null,
        product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' },
        components: [
            {
                id: 'comp-1',
                recipeId: 'recipe-1',
                productId: 'product-flour',
                quantity: 5,
                product: { id: 'product-flour', name: 'Flour', sku: 'FLR-1' },
            },
            {
                id: 'comp-2',
                recipeId: 'recipe-1',
                productId: 'product-yeast',
                quantity: 1,
                product: { id: 'product-yeast', name: 'Yeast', sku: 'YST-1' },
            },
        ],
    };

    beforeEach(async () => {
        db = {
            bomRecipe: { findFirst: jest.fn() },
            productStock: {
                aggregate: jest.fn(),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUnique: jest.fn().mockResolvedValue({ quantity: 100 }),
                upsert: jest.fn().mockResolvedValue({ quantity: 20 }),
            },
            productionJob: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
            productionWastage: { create: jest.fn().mockResolvedValue({}) },
            productionJobCost: {
                create: jest.fn().mockResolvedValue({}),
                aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({}),
            },
            product: { findMany: jest.fn().mockResolvedValue([]) },
            productPrice: { findMany: jest.fn().mockResolvedValue([]) },
            warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh-1' }) },
            inventoryMovement: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ManufacturingService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<ManufacturingService>(ManufacturingService);
    });

    describe('getRequirementsPreview()', () => {
        it('reports sufficient when stock covers every component', async () => {
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productStock.aggregate
                .mockResolvedValueOnce({ _sum: { quantity: 50 } }) // flour: need 5*10=50
                .mockResolvedValueOnce({ _sum: { quantity: 10 } }); // yeast: need 1*10=10

            const preview = await service.getRequirementsPreview('tenant-1', 'recipe-1', 10);

            expect(preview.sufficient).toBe(true);
            expect(preview.outputQty).toBe(20);
            expect(preview.components).toEqual([
                expect.objectContaining({ productId: 'product-flour', requiredQty: 50, availableQty: 50, sufficient: true }),
                expect.objectContaining({ productId: 'product-yeast', requiredQty: 10, availableQty: 10, sufficient: true }),
            ]);
        });

        it('flags components with insufficient stock without throwing', async () => {
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productStock.aggregate
                .mockResolvedValueOnce({ _sum: { quantity: 20 } }) // flour: need 50, have 20
                .mockResolvedValueOnce({ _sum: { quantity: 10 } }); // yeast: need 10, have 10

            const preview = await service.getRequirementsPreview('tenant-1', 'recipe-1', 10);

            expect(preview.sufficient).toBe(false);
            expect(preview.components[0]).toEqual(
                expect.objectContaining({ productId: 'product-flour', requiredQty: 50, availableQty: 20, sufficient: false }),
            );
            expect(preview.components[1].sufficient).toBe(true);
        });
    });

    describe('startJob()', () => {
        const job = {
            id: 'job-1',
            tenantId: 'tenant-1',
            recipeId: 'recipe-1',
            productId: 'product-out',
            quantity: 10,
            status: 'DRAFT',
            recipe,
        };

        it('starts the job when all components have sufficient stock', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productStock.aggregate
                .mockResolvedValueOnce({ _sum: { quantity: 50 } })
                .mockResolvedValueOnce({ _sum: { quantity: 10 } });
            db.productionJob.update.mockResolvedValue({ ...job, status: 'IN_PROGRESS' });

            const result = await service.startJob('tenant-1', 'job-1');

            expect(result.status).toBe('IN_PROGRESS');
            expect(db.productionJob.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'job-1' }, data: expect.objectContaining({ status: 'IN_PROGRESS' }) }),
            );
        });

        it('throws BadRequestException when a component is short on stock', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productStock.aggregate
                .mockResolvedValueOnce({ _sum: { quantity: 20 } })
                .mockResolvedValueOnce({ _sum: { quantity: 10 } });

            await expect(service.startJob('tenant-1', 'job-1')).rejects.toThrow(BadRequestException);
            expect(db.productionJob.update).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when the job is not in DRAFT status', async () => {
            db.productionJob.findFirst.mockResolvedValue({ ...job, status: 'IN_PROGRESS' });

            await expect(service.startJob('tenant-1', 'job-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('completeJob()', () => {
        const job = {
            id: 'job-1',
            tenantId: 'tenant-1',
            recipeId: 'recipe-1',
            productId: 'product-out',
            quantity: 10,
            status: 'IN_PROGRESS',
            recipe,
        };

        it('consumes BOM components and credits output stock with no wastage', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });

            const result = await service.completeJob('tenant-1', 'job-1');

            expect(result.status).toBe('COMPLETED');
            expect(db.inventoryMovement.create).toHaveBeenCalledTimes(3); // 2 components + 1 output
            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ movement_type: 'MANUFACTURING_OUTPUT', quantity_delta: 20 }),
                }),
            );
            expect(db.productionWastage.create).not.toHaveBeenCalled();
        });

        it('records wastage as an additional consumption movement and a ProductionWastage row', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });
            db.product.findMany.mockResolvedValue([{ id: 'product-flour' }]);

            await service.completeJob('tenant-1', 'job-1', [
                { productId: 'product-flour', quantity: 3, note: 'Spilled during mixing' },
            ]);

            expect(db.inventoryMovement.create).toHaveBeenCalledTimes(4); // 2 components + 1 wastage + 1 output
            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        movement_type: 'MANUFACTURING_WASTAGE',
                        product_id: 'product-flour',
                        quantity_delta: -3,
                    }),
                }),
            );
            expect(db.productionWastage.create).toHaveBeenCalledWith({
                data: {
                    tenantId: 'tenant-1',
                    jobId: 'job-1',
                    productId: 'product-flour',
                    quantity: 3,
                    note: 'Spilled during mixing',
                },
            });
        });

        it('stamps inventory movements with the current cost price', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });
            db.productPrice.findMany.mockResolvedValue([
                { product_id: 'product-flour', cost: 2.5 },
                { product_id: 'product-out', cost: 10 },
            ]);

            await service.completeJob('tenant-1', 'job-1');

            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ product_id: 'product-flour', unit_cost: 2.5 }),
                }),
            );
            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ movement_type: 'MANUFACTURING_OUTPUT', unit_cost: 10 }),
                }),
            );
        });

        it('throws BadRequestException when a wastage product does not belong to the tenant', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.product.findMany.mockResolvedValue([]); // product not found for this tenant

            await expect(
                service.completeJob('tenant-1', 'job-1', [{ productId: 'not-mine', quantity: 1 }]),
            ).rejects.toThrow(BadRequestException);
            expect(db.productionJob.update).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when the job is not IN_PROGRESS', async () => {
            db.productionJob.findFirst.mockResolvedValue({ ...job, status: 'DRAFT' });

            await expect(service.completeJob('tenant-1', 'job-1')).rejects.toThrow(BadRequestException);
        });

        it('rolls up raw-material cost into a ProductionJobCost line and sets totalJobCost/costPerUnit', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });
            db.productPrice.findMany.mockResolvedValue([{ product_id: 'product-flour', cost: 2.5 }]);
            // flour: 5 * 10 qty = 50 units * 2.5 = 125; yeast has no cost entry -> 0
            db.productionJobCost.aggregate.mockResolvedValue({ _sum: { amount: 125 } });

            await service.completeJob('tenant-1', 'job-1');

            expect(db.productionJobCost.create).toHaveBeenCalledWith({
                data: {
                    tenantId: 'tenant-1',
                    jobId: 'job-1',
                    costType: 'RAW_MATERIAL',
                    amount: 125,
                    notes: 'Auto-computed from BOM consumption + wastage at completion',
                },
            });
            expect(db.productionJob.update).toHaveBeenLastCalledWith({
                where: { id: 'job-1' },
                data: { status: 'COMPLETED', completedAt: expect.any(Date), totalJobCost: 125, costPerUnit: 6.25 },
            });
        });
    });

    describe('job cost lines', () => {
        const job = {
            id: 'job-1',
            tenantId: 'tenant-1',
            recipeId: 'recipe-1',
            productId: 'product-out',
            quantity: 10,
            status: 'IN_PROGRESS',
            recipe,
        };

        it('adds a non-material cost line and recomputes job totals', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJobCost.create.mockResolvedValue({ id: 'cost-1', costType: 'PRINTING', amount: 500 });
            db.productionJobCost.aggregate.mockResolvedValue({ _sum: { amount: 500 } });

            await service.addJobCost('tenant-1', 'job-1', { costType: 'PRINTING', amount: 500 });

            expect(db.productionJobCost.create).toHaveBeenCalledWith({
                data: {
                    tenantId: 'tenant-1',
                    jobId: 'job-1',
                    costType: 'PRINTING',
                    amount: 500,
                    sourcePurchaseItemId: null,
                    notes: null,
                },
            });
            expect(db.productionJob.update).toHaveBeenCalledWith({
                where: { id: 'job-1' },
                data: { totalJobCost: 500, costPerUnit: 25 },
            });
        });

        it('rejects removing a RAW_MATERIAL cost line directly', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJobCost.findFirst.mockResolvedValue({ id: 'cost-1', costType: 'RAW_MATERIAL' });

            await expect(service.removeJobCost('tenant-1', 'job-1', 'cost-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('getAnalytics()', () => {
        it('returns zeroed-out totals when there are no completed jobs', async () => {
            db.productionJob.findMany.mockResolvedValue([]);

            const result = await service.getAnalytics('tenant-1');

            expect(result).toEqual({
                totalCompletedJobs: 0,
                totalUnitsProduced: 0,
                totalMaterialCost: 0,
                avgUnitProductionCost: 0,
                jobs: [],
                volumeTrend: [],
            });
        });

        it('computes planned/wastage/actual cost, unit cost, and a volume trend across completed jobs', async () => {
            const completedJobs = [
                {
                    id: 'job-1',
                    tenantId: 'tenant-1',
                    quantity: 10,
                    completedAt: new Date('2026-07-01T10:00:00Z'),
                    created_at: new Date('2026-06-30T10:00:00Z'),
                    recipe: { outputQty: 2, product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' } },
                },
                {
                    id: 'job-2',
                    tenantId: 'tenant-1',
                    quantity: 5,
                    completedAt: new Date('2026-07-02T10:00:00Z'),
                    created_at: new Date('2026-07-01T10:00:00Z'),
                    recipe: { outputQty: 2, product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' } },
                },
            ];
            db.productionJob.findMany.mockResolvedValue(completedJobs);
            db.inventoryMovement.findMany.mockResolvedValue([
                { reference_id: 'job-1', movement_type: 'MANUFACTURING_CONSUMPTION', quantity_delta: -50, unit_cost: 2 }, // 100
                { reference_id: 'job-1', movement_type: 'MANUFACTURING_WASTAGE', quantity_delta: -3, unit_cost: 2 }, // 6
                { reference_id: 'job-2', movement_type: 'MANUFACTURING_CONSUMPTION', quantity_delta: -25, unit_cost: 2 }, // 50
            ]);

            const result = await service.getAnalytics('tenant-1');

            expect(result.totalCompletedJobs).toBe(2);
            expect(result.totalUnitsProduced).toBe(30); // (10*2) + (5*2)
            expect(result.totalMaterialCost).toBe(156); // 106 + 50
            expect(result.avgUnitProductionCost).toBeCloseTo(156 / 30);

            expect(result.jobs).toEqual([
                expect.objectContaining({
                    jobId: 'job-1',
                    quantityProduced: 20,
                    plannedMaterialCost: 100,
                    wastageCost: 6,
                    actualMaterialCost: 106,
                    unitProductionCost: 106 / 20,
                }),
                expect.objectContaining({
                    jobId: 'job-2',
                    quantityProduced: 10,
                    plannedMaterialCost: 50,
                    wastageCost: 0,
                    actualMaterialCost: 50,
                    unitProductionCost: 5,
                }),
            ]);

            expect(result.volumeTrend).toEqual([
                { date: '2026-07-01', quantityProduced: 20 },
                { date: '2026-07-02', quantityProduced: 10 },
            ]);
        });
    });
});
