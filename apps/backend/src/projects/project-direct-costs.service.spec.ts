import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const applyInventoryMovement = jest.fn().mockResolvedValue(undefined);
const resolveProductCosts = jest.fn();
jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: (...args: any[]) => applyInventoryMovement(...args),
    assertWarehouseBelongsToTenant: async () => ({ id: 'wh-1', store_id: 'store-1' }),
}));
jest.mock('../database/product-cost.utils', () => ({
    resolveProductCosts: (...args: any[]) => resolveProductCosts(...args),
}));

import { ProjectDirectCostsService } from './project-direct-costs.service';
import { OWNER } from './project-access.test-support';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('ProjectDirectCostsService', () => {
    let db: any;
    let access: { assertProjectVisible: jest.Mock; projectFilter: jest.Mock };
    let audit: { log: jest.Mock };
    let service: ProjectDirectCostsService;

    beforeEach(() => {
        jest.clearAllMocks();
        db = {
            purchaseItem: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
            productionJobCost: { groupBy: jest.fn().mockResolvedValue([]) },
            projectCostEntry: {
                groupBy: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({ id: 'c1' }),
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                delete: jest.fn(),
            },
            projectMaterialIssue: {
                create: jest.fn(async ({ data }: any) => ({ id: 'iss-1', lines: data.lines.create })),
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                delete: jest.fn(),
            },
            expenseEntry: { findMany: jest.fn().mockResolvedValue([]) },
            product: { findMany: jest.fn() },
            project: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn(async (fn: any) => fn(db)),
        };
        access = {
            assertProjectVisible: jest.fn().mockResolvedValue({ id: 'p1' }),
            projectFilter: jest.fn().mockResolvedValue({}),
        };
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        service = new ProjectDirectCostsService(db, access as any, audit as any);
    });

    describe('addCost from a bill line', () => {
        const dto = { category: 'SERVICES' as const, amount: 400, costDate: '2026-08-10', description: 'Site transport', sourcePurchaseItemId: 'pi-1' };
        const line = (overrides: Record<string, unknown> = {}) => ({
            id: 'pi-1',
            line_total: 1000,
            product: { type: 'SERVICE' },
            purchase: { status: 'RECORDED' },
            ...overrides,
        });

        it('draws a share within what is left on the line, counting production jobs too', async () => {
            db.purchaseItem.findFirst.mockResolvedValue(line());
            db.productionJobCost.groupBy.mockResolvedValue([{ sourcePurchaseItemId: 'pi-1', _sum: { amount: 600 } }]);

            await service.addCost(OWNER, 'p1', dto, { userId: 'owner' });

            expect(db.projectCostEntry.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ amount: 400, category: 'SERVICES', source_purchase_item_id: 'pi-1' }),
            });
        });

        it('refuses a share that would overdraw the line', async () => {
            db.purchaseItem.findFirst.mockResolvedValue(line());
            db.projectCostEntry.groupBy.mockResolvedValue([{ source_purchase_item_id: 'pi-1', _sum: { amount: 700 } }]);

            await expect(service.addCost(OWNER, 'p1', dto, {})).rejects.toThrow(BadRequestException);
            expect(db.projectCostEntry.create).not.toHaveBeenCalled();
        });

        it('refuses a goods line — goods reach a project by being issued from stock', async () => {
            db.purchaseItem.findFirst.mockResolvedValue(line({ product: { type: 'GOODS' } }));

            await expect(service.addCost(OWNER, 'p1', dto, {})).rejects.toThrow(/Issue goods to the project from stock/);
        });

        it('refuses a cancelled bill', async () => {
            db.purchaseItem.findFirst.mockResolvedValue(line({ purchase: { status: 'CANCELLED' } }));

            await expect(service.addCost(OWNER, 'p1', dto, {})).rejects.toThrow(BadRequestException);
        });

        it('records a cost with no bill behind it', async () => {
            await service.addCost(OWNER, 'p1', { ...dto, sourcePurchaseItemId: undefined, category: 'OVERHEAD' }, {});

            expect(db.purchaseItem.findFirst).not.toHaveBeenCalled();
            expect(db.projectCostEntry.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ category: 'OVERHEAD', source_purchase_item_id: null }),
            });
        });
    });

    describe('issueMaterials', () => {
        const dto = {
            warehouseId: 'wh-1',
            issueDate: '2026-09-02',
            items: [
                { productId: 'cement', quantity: 10 },
                { productId: 'new-tile', quantity: 4 },
            ],
        };

        beforeEach(() => {
            db.product.findMany.mockResolvedValue([
                { id: 'cement', type: 'GOODS' },
                { id: 'new-tile', type: 'GOODS' },
            ]);
            // The pool has a cost for cement, none yet for the tiles.
            resolveProductCosts.mockResolvedValue(new Map([['cement', 520]]));
        });

        it('takes the goods out at the average, leaving a line the pool cannot cost uncosted', async () => {
            await service.issueMaterials(OWNER, 'p1', dto, { userId: 'owner' });

            const lines = db.projectMaterialIssue.create.mock.calls[0][0].data.lines.create;
            expect(lines).toEqual([
                { product_id: 'cement', quantity: 10, unit_cost: 520, line_cost: 5200 },
                { product_id: 'new-tile', quantity: 4, unit_cost: null, line_cost: null },
            ]);
            expect(applyInventoryMovement).toHaveBeenCalledWith(db, expect.objectContaining({
                productId: 'cement',
                quantityDelta: -10,
                movementType: 'PROJECT_ISSUE',
                referenceId: 'iss-1',
            }));
            expect(resolveProductCosts).toHaveBeenCalledWith(db, { tenantId: 'tenant-1', storeId: 'store-1', productIds: ['cement', 'new-tile'] });
        });

        it('reads the average before the stock moves', async () => {
            await service.issueMaterials(OWNER, 'p1', dto, {});

            expect(resolveProductCosts.mock.invocationCallOrder[0]).toBeLessThan(applyInventoryMovement.mock.invocationCallOrder[0]);
        });

        it('refuses a service, which holds no stock', async () => {
            db.product.findMany.mockResolvedValue([
                { id: 'cement', type: 'GOODS' },
                { id: 'new-tile', type: 'SERVICE' },
            ]);

            await expect(service.issueMaterials(OWNER, 'p1', dto, {})).rejects.toThrow(BadRequestException);
            expect(applyInventoryMovement).not.toHaveBeenCalled();
        });

        it('refuses the same product twice on one issue', async () => {
            await expect(
                service.issueMaterials(OWNER, 'p1', { ...dto, items: [dto.items[0], dto.items[0]] }, {}),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('reverseIssue', () => {
        it('puts the goods back at the cost they left at, then removes the issue', async () => {
            db.projectMaterialIssue.findFirst.mockResolvedValue({
                id: 'iss-1',
                warehouse_id: 'wh-1',
                lines: [
                    { product_id: 'cement', quantity: 10, unit_cost: new Prisma.Decimal(520) },
                    { product_id: 'new-tile', quantity: 4, unit_cost: null },
                ],
            });

            await service.reverseIssue(OWNER, 'p1', 'iss-1', {});

            expect(applyInventoryMovement).toHaveBeenNthCalledWith(1, db, expect.objectContaining({
                productId: 'cement', quantityDelta: 10, movementType: 'PROJECT_ISSUE_REVERSAL', unitCost: 520,
            }));
            // No stored cost: joins the pool as a quantity only.
            expect(applyInventoryMovement.mock.calls[1][1]).not.toHaveProperty('unitCost');
            expect(db.projectMaterialIssue.delete).toHaveBeenCalledWith({ where: { id: 'iss-1' } });
        });

        it('cannot reverse an issue of another project', async () => {
            db.projectMaterialIssue.findFirst.mockResolvedValue(null);

            await expect(service.reverseIssue(OWNER, 'p1', 'iss-x', {})).rejects.toThrow(NotFoundException);
            expect(applyInventoryMovement).not.toHaveBeenCalled();
        });
    });

    describe('list', () => {
        it('puts every kind of direct cost in one list, newest first', async () => {
            db.projectCostEntry.findMany.mockResolvedValue([
                { id: 'c1', cost_date: day('2026-08-10'), category: 'SERVICES', description: 'Transport', amount: new Prisma.Decimal(400), sourcePurchaseItem: { product: { name: 'Trucking' }, purchase: { purchase_number: 'PUR-1', supplier: { name: 'Hauliers' } } } },
            ]);
            db.projectMaterialIssue.findMany.mockResolvedValue([
                { id: 'iss-1', issue_date: day('2026-09-02'), warehouse: { name: 'Main' }, lines: [{ quantity: 10, line_cost: new Prisma.Decimal(5200), product: { name: 'Cement' } }] },
            ]);
            db.expenseEntry.findMany.mockResolvedValue([
                { id: 'x1', expense_date: day('2026-08-15'), amount: new Prisma.Decimal(200), description: null, head: { name: 'Tea' }, category: { name: 'Refreshments' } },
            ]);

            const rows = await service.list(OWNER, 'p1');

            expect(rows.map((row) => [row.kind, row.date, row.category, row.amount])).toEqual([
                ['ISSUE', '2026-09-02', 'MATERIAL', 5200],
                ['EXPENSE', '2026-08-15', 'EXPENSE', 200],
                ['ENTRY', '2026-08-10', 'SERVICES', 400],
            ]);
            expect(rows[2].source).toBe('PUR-1 · Hauliers · Trucking');
            expect(rows[0].description).toBe('10 × Cement');
        });
    });

    describe('costSources', () => {
        it('lists live service lines with something left to draw', async () => {
            db.purchaseItem.findMany.mockResolvedValue([
                { id: 'pi-1', line_total: 1000, product: { name: 'Trucking' }, purchase: { purchase_number: 'PUR-1', purchase_date: day('2026-08-01'), created_at: day('2026-08-01'), supplier: { name: 'Hauliers' } } },
                { id: 'pi-2', line_total: 500, product: { name: 'Printing' }, purchase: { purchase_number: 'PUR-2', purchase_date: null, created_at: day('2026-08-03'), supplier: null } },
            ]);
            db.projectCostEntry.groupBy.mockResolvedValue([{ source_purchase_item_id: 'pi-2', _sum: { amount: 500 } }]);

            const rows = await service.costSources('tenant-1');

            expect(rows).toEqual([expect.objectContaining({ id: 'pi-1', remainingAmount: 1000, supplierName: 'Hauliers' })]);
            expect(db.purchaseItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    purchase: { tenant_id: 'tenant-1', status: { not: 'CANCELLED' } },
                    product: { type: 'SERVICE' },
                }),
            }));
        });
    });
});
