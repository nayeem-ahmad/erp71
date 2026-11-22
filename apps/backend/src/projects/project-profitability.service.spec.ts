import { Prisma } from '@prisma/client';
import { ProjectProfitabilityService } from './project-profitability.service';
import { OWNER } from './project-access.test-support';

const dec = (value: number) => new Prisma.Decimal(value);

describe('ProjectProfitabilityService', () => {
    let db: any;
    let access: { projectFilter: jest.Mock };
    let service: ProjectProfitabilityService;

    const project = (id: string, overrides: Record<string, unknown> = {}) => ({
        id,
        code: id.toUpperCase(),
        name: `Project ${id}`,
        status: 'ACTIVE',
        billing_type: 'FIXED_PRICE',
        budget_amount: null,
        contract_value: null,
        customer: { name: 'Rahim Traders' },
        ...overrides,
    });

    beforeEach(() => {
        db = {
            project: {
                findMany: jest.fn().mockResolvedValue([
                    project('p1', { budget_amount: dec(10000), contract_value: dec(12000) }),
                    project('p2', { billing_type: 'TIME_AND_MATERIALS', customer: null }),
                    project('p3', { billing_type: 'INTERNAL', customer: null }),
                ]),
            },
            projectTimeEntry: {
                groupBy: jest.fn()
                    // priced hours
                    .mockResolvedValueOnce([
                        { project_id: 'p1', _sum: { cost_amount: dec(3000) } },
                        { project_id: 'p2', _sum: { cost_amount: dec(800) } },
                        { project_id: 'p3', _sum: { cost_amount: dec(400) } },
                    ])
                    // uncosted hours
                    .mockResolvedValueOnce([{ project_id: 'p2', _sum: { hours: dec(3) } }]),
            },
            projectCostEntry: { groupBy: jest.fn().mockResolvedValue([{ project_id: 'p1', _sum: { amount: dec(1000) } }]) },
            projectMaterialIssueLine: {
                findMany: jest.fn().mockResolvedValue([
                    { line_cost: dec(500), issue: { project_id: 'p1' } },
                    { line_cost: dec(100), issue: { project_id: 'p3' } },
                ]),
            },
            expenseEntry: { groupBy: jest.fn().mockResolvedValue([{ project_id: 'p2', _sum: { amount: dec(200) } }]) },
            sale: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 's1', project_id: 'p1', total_amount: dec(5750), vat_amount: dec(750), sd_amount: dec(0) },
                    { id: 's2', project_id: 'p2', total_amount: dec(2300), vat_amount: dec(300), sd_amount: dec(0) },
                ]),
            },
            salesReturn: {
                // 1,150 back on s1 is 1,000 of revenue at its net share.
                findMany: jest.fn().mockResolvedValue([{ sale_id: 's1', total_refund: dec(1150) }]),
            },
        };
        access = { projectFilter: jest.fn().mockResolvedValue({ OR: [{ visibility: 'PUBLIC' }, { manager_id: 'owner' }] }) };
        service = new ProjectProfitabilityService(db, access as any);
    });

    it('gives each project its cost, revenue net of VAT and returns, and margin — none on an internal one', async () => {
        const result = await service.report(OWNER, {});

        expect(result.rows.map((row) => [row.code, row.labourCost, row.directCost, row.cost, row.revenue, row.margin, row.marginPct])).toEqual([
            ['P1', 3000, 1500, 4500, 4000, -500, -12.5],
            ['P2', 800, 200, 1000, 2000, 1000, 50],
            ['P3', 400, 100, 500, 0, null, null],
        ]);
        expect(result.rows[0]).toEqual(expect.objectContaining({ budget: 10000, budgetUsedPct: 45, contractValue: 12000, customer: 'Rahim Traders' }));
        expect(result.rows[1]).toEqual(expect.objectContaining({ uncostedHours: 3, budget: null, budgetUsedPct: null }));
    });

    it('totals margin over billed projects only, and keeps the internal cost apart', async () => {
        const { totals } = await service.report(OWNER, {});

        expect(totals).toEqual({
            projects: 3,
            cost: 6000,
            internalCost: 500,
            revenue: 6000,
            billedCost: 5500,
            margin: 500,
            marginPct: 8.33,
            uncostedHours: 3,
        });
    });

    it('lists only projects the viewer can see, every status but cancelled by default', async () => {
        await service.report(OWNER, {});

        expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenant_id: 'tenant-1',
                deleted_at: null,
                status: { not: 'CANCELLED' },
                OR: [{ visibility: 'PUBLIC' }, { manager_id: 'owner' }],
            }),
        }));
        // Every other read is limited to those projects.
        expect(db.sale.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenant_id: 'tenant-1', project_id: { in: ['p1', 'p2', 'p3'] }, status: { not: 'CANCELLED' } },
        }));
        expect(db.projectCostEntry.groupBy).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: [
                    { source_purchase_item_id: null },
                    { sourcePurchaseItem: { purchase: { status: { not: 'CANCELLED' } } } },
                ],
            }),
        }));
    });

    it('filters by status and billing type, ignoring statuses it does not know', async () => {
        await service.report(OWNER, { status: 'active, on_hold,bogus', billingType: 'FIXED_PRICE' });

        expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: { in: ['ACTIVE', 'ON_HOLD'] }, billing_type: 'FIXED_PRICE' }),
        }));
    });

    it('reads nothing else when no project matches', async () => {
        db.project.findMany.mockResolvedValue([]);

        const result = await service.report(OWNER, {});

        expect(result.rows).toEqual([]);
        expect(result.totals.projects).toBe(0);
        expect(result.totals.marginPct).toBeNull();
        expect(db.projectTimeEntry.groupBy).not.toHaveBeenCalled();
        expect(db.sale.findMany).not.toHaveBeenCalled();
    });
});
