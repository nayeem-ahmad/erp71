import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProjectCostingService } from './project-costing.service';
import { LabourPricingService } from './labour-pricing.service';
import { OWNER } from './project-access.test-support';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('ProjectCostingService', () => {
    let db: any;
    let access: { assertProjectVisible: jest.Mock };
    let audit: { log: jest.Mock };
    let billing: { unbilledHours: jest.Mock };
    let service: ProjectCostingService;

    beforeEach(() => {
        db = {
            project: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'p1', code: 'BS23', name: 'Fit-out', budget_amount: new Prisma.Decimal(10000),
                    billing_type: 'INTERNAL', contract_value: null, bill_rate: null,
                }),
            },
            sale: { findMany: jest.fn().mockResolvedValue([]) },
            salesReturn: { findMany: jest.fn().mockResolvedValue([]) },
            projectTimeEntry: {
                groupBy: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            projectTask: { aggregate: jest.fn().mockResolvedValue({ _sum: { remaining_hours: new Prisma.Decimal(10) } }) },
            projectCostEntry: { findMany: jest.fn().mockResolvedValue([]) },
            projectMaterialIssue: { findMany: jest.fn().mockResolvedValue([]) },
            expenseEntry: { findMany: jest.fn().mockResolvedValue([]) },
            projectCostingSettings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
            employee: { findMany: jest.fn(), findFirst: jest.fn() },
            employeeCostRate: { findMany: jest.fn().mockResolvedValue([]) },
            user: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
        };
        access = { assertProjectVisible: jest.fn().mockResolvedValue({ id: 'p1' }) };
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        billing = { unbilledHours: jest.fn().mockResolvedValue({ hours: 0, amount: 0, unratedHours: 0, people: [], entryIds: [] }) };
        service = new ProjectCostingService(db, access as any, new LabourPricingService(db), audit as any, billing as any);
    });

    describe('financials', () => {
        beforeEach(() => {
            db.projectTimeEntry.groupBy
                // by person
                .mockResolvedValueOnce([
                    { employee_id: 'e1', user_id: 'u1', _sum: { hours: 10, cost_amount: 2000 } },
                    { employee_id: 'e2', user_id: 'u2', _sum: { hours: 5, cost_amount: 1500 } },
                    { employee_id: null, user_id: 'u3', _sum: { hours: 4, cost_amount: null } },
                ])
                // uncosted by person
                .mockResolvedValueOnce([
                    { employee_id: 'e2', user_id: 'u2', _sum: { hours: 1 } },
                    { employee_id: null, user_id: 'u3', _sum: { hours: 4 } },
                ])
                // by day
                .mockResolvedValueOnce([
                    { work_date: day('2026-08-03'), _sum: { hours: 9, cost_amount: 1800 } },
                    { work_date: day('2026-08-20'), _sum: { hours: 6, cost_amount: 1200 } },
                    { work_date: day('2026-09-01'), _sum: { hours: 4, cost_amount: 500 } },
                ]);
            db.employee.findMany.mockResolvedValue([
                { id: 'e1', name: 'Karim', employee_code: 'EMP-1' },
                { id: 'e2', name: 'Abdul', employee_code: 'EMP-2' },
            ]);
            db.user.findMany.mockResolvedValue([{ id: 'u3', name: null, email: 'temp@example.com' }]);
        });

        it('totals labour cost against the budget, counting uncosted hours apart', async () => {
            const result = await service.financials(OWNER, 'p1');

            expect(result.totals).toEqual({
                hours: 19,
                costedHours: 14,
                uncostedHours: 5,
                labourCost: 3500,
                directCost: 0,
                totalCost: 3500,
                budget: 10000,
                budgetUsedPct: 35,
                budgetRemaining: 6500,
                averageRate: 250,
            });
            expect(result.uncosted).toEqual({ noEmployeeHours: 4, noRateHours: 1, materialLines: 0 });
        });

        it('forecasts the rest of the work at the project\'s own average rate', async () => {
            const result = await service.financials(OWNER, 'p1');

            expect(result.forecast).toEqual({
                remainingHours: 10,
                estimatedRemainingCost: 2500,
                estimateAtCompletion: 6000,
            });
            expect(db.projectTask.aggregate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ deleted_at: null, status: { category: { not: 'DONE' } } }),
                }),
            );
        });

        it('lists people by cost, named from their card or else their login', async () => {
            const result = await service.financials(OWNER, 'p1');

            expect(result.byPerson.map((row) => [row.name, row.employeeCode, row.labourCost, row.uncostedHours])).toEqual([
                ['Karim', 'EMP-1', 2000, 0],
                ['Abdul', 'EMP-2', 1500, 1],
                ['temp@example.com', null, 0, 4],
            ]);
        });

        it('rolls days up into months', async () => {
            const result = await service.financials(OWNER, 'p1');

            expect(result.byMonth).toEqual([
                { month: '2026-08', hours: 15, labourCost: 3000, directCost: 0, totalCost: 3000, revenue: 0 },
                { month: '2026-09', hours: 4, labourCost: 500, directCost: 0, totalCost: 500, revenue: 0 },
            ]);
        });

        describe('revenue and margin', () => {
            const sale = (id: string, total: number, vat: number, date: string) => ({
                id, total_amount: new Prisma.Decimal(total), vat_amount: new Prisma.Decimal(vat), sd_amount: new Prisma.Decimal(0), sale_date: day(date),
            });

            it('counts invoices net of VAT, less returns, and sets the margin against total cost', async () => {
                db.project.findFirst.mockResolvedValue({
                    id: 'p1', code: 'BS23', name: 'Fit-out', budget_amount: null,
                    billing_type: 'FIXED_PRICE', contract_value: new Prisma.Decimal(12000), bill_rate: null,
                });
                db.sale.findMany.mockResolvedValue([sale('s1', 5750, 750, '2026-08-20'), sale('s2', 1150, 150, '2026-09-05')]);
                // A refund of 1,150 on s1 is 1,000 of revenue at its 5,000/5,750 net share.
                db.salesReturn.findMany.mockResolvedValue([{ sale_id: 's1', total_refund: new Prisma.Decimal(1150), created_at: day('2026-09-10') }]);

                const result = await service.financials(OWNER, 'p1');

                expect(db.sale.findMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { tenant_id: 'tenant-1', project_id: 'p1', status: { not: 'CANCELLED' } },
                }));
                expect(result.revenue).toEqual(expect.objectContaining({
                    billingType: 'FIXED_PRICE',
                    invoiced: 6900,
                    revenue: 5000,
                    margin: 1500,          // 5,000 − 3,500 labour
                    marginPct: 30,
                    leftToInvoice: 7000,   // 12,000 contract − 5,000 billed
                    expectedRevenue: 12000,
                    expectedCost: 6000,    // 3,500 so far + 2,500 forecast labour
                    expectedMargin: 6000,
                }));
                expect(result.byMonth.find((row) => row.month === '2026-08')!.revenue).toBe(5000);
                expect(result.byMonth.find((row) => row.month === '2026-09')!.revenue).toBe(0);
            });

            it('adds unbilled hours to expected revenue on time and materials', async () => {
                db.project.findFirst.mockResolvedValue({
                    id: 'p1', code: 'BS23', name: 'Fit-out', budget_amount: null,
                    billing_type: 'TIME_AND_MATERIALS', contract_value: null, bill_rate: new Prisma.Decimal(500),
                });
                db.sale.findMany.mockResolvedValue([sale('s1', 4600, 600, '2026-08-31')]);
                billing.unbilledHours.mockResolvedValue({ hours: 6, amount: 3000, unratedHours: 0, people: [], entryIds: ['t1'] });

                const result = await service.financials(OWNER, 'p1');

                expect(result.revenue).toEqual(expect.objectContaining({
                    revenue: 4000,
                    unbilledHours: 6,
                    unbilledAmount: 3000,
                    expectedRevenue: 7000,
                    leftToInvoice: null,
                }));
            });

            it('shows no margin percentage, and expects nothing, on an internal project', async () => {
                const result = await service.financials(OWNER, 'p1');

                expect(result.revenue).toEqual(expect.objectContaining({
                    billingType: 'INTERNAL', revenue: 0, margin: -3500, marginPct: null, expectedRevenue: null,
                }));
                expect(billing.unbilledHours).not.toHaveBeenCalled();
            });
        });

        it('adds expenses, cost entries and issued materials, and measures the budget against all of it', async () => {
            db.projectCostEntry.findMany.mockResolvedValue([
                { category: 'SERVICES', amount: new Prisma.Decimal(1000), cost_date: day('2026-08-10') },
            ]);
            db.projectMaterialIssue.findMany.mockResolvedValue([
                { issue_date: day('2026-09-02'), lines: [{ line_cost: new Prisma.Decimal(500) }, { line_cost: null }] },
            ]);
            db.expenseEntry.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(200), expense_date: day('2026-08-15') }]);

            const result = await service.financials(OWNER, 'p1');

            expect(result.totals).toEqual(expect.objectContaining({
                labourCost: 3500,
                directCost: 1700,
                totalCost: 5200,
                budgetUsedPct: 52,
                budgetRemaining: 4800,
            }));
            expect(result.byCategory).toEqual([
                { category: 'LABOUR', amount: 3500 },
                { category: 'MATERIAL', amount: 500 },
                { category: 'SERVICES', amount: 1000 },
                { category: 'EXPENSE', amount: 200 },
            ]);
            // The uncosted issue line is reported, never counted as free.
            expect(result.uncosted.materialLines).toBe(1);
            expect(result.byMonth).toEqual([
                { month: '2026-08', hours: 15, labourCost: 3000, directCost: 1200, totalCost: 4200, revenue: 0 },
                { month: '2026-09', hours: 4, labourCost: 500, directCost: 500, totalCost: 1000, revenue: 0 },
            ]);
            // A share of a cancelled bill no longer counts.
            expect(db.projectCostEntry.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [
                            { source_purchase_item_id: null },
                            { sourcePurchaseItem: { purchase: { status: { not: 'CANCELLED' } } } },
                        ],
                    }),
                }),
            );
        });

        it('says nothing about budget use for a project with no budget', async () => {
            db.project.findFirst.mockResolvedValue({ id: 'p1', code: 'X', name: 'X', budget_amount: null });

            const result = await service.financials(OWNER, 'p1');

            expect(result.totals.budget).toBeNull();
            expect(result.totals.budgetUsedPct).toBeNull();
            expect(result.totals.budgetRemaining).toBeNull();
        });

        it('is no wider than the project: an invisible project is not found', async () => {
            access.assertProjectVisible.mockRejectedValue(new NotFoundException('Project not found'));

            await expect(service.financials(OWNER, 'p-private')).rejects.toThrow(NotFoundException);
            expect(db.projectTimeEntry.groupBy).not.toHaveBeenCalled();
        });
    });

    describe('priceUncosted', () => {
        it('prices only hours with an employee and no cost, at each day\'s rate, and never overwrites', async () => {
            db.projectTimeEntry.findMany.mockResolvedValue([
                { id: 't1', employee_id: 'e1', work_date: day('2026-08-03'), hours: 2 },
                { id: 't2', employee_id: 'e2', work_date: day('2026-08-03'), hours: 1 },
            ]);
            db.employee.findMany.mockResolvedValue([
                { id: 'e1', basic_salary: 41600 },
                { id: 'e2', basic_salary: null },
            ]);

            const result = await service.priceUncosted(OWNER, 'p1', { userId: 'owner' });

            expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: 'tenant-1', project_id: 'p1', cost_amount: null, employee_id: { not: null } },
                }),
            );
            expect(result).toEqual({ priced: 1, stillUncosted: 1 });
            expect(db.projectTimeEntry.updateMany).toHaveBeenCalledTimes(1);
            const [call] = db.projectTimeEntry.updateMany.mock.calls;
            expect(call[0].where).toEqual({ id: 't1', cost_amount: null });
            expect(Number(call[0].data.cost_amount)).toBe(400);
            expect(audit.log).toHaveBeenCalledWith(
                'PROJECT_HOURS_PRICED', 'Project', expect.anything(), 'p1', { priced: 1, still_uncosted: 1 },
            );
        });
    });

    describe('settings', () => {
        it('saves and audits the hours and overhead', async () => {
            db.projectCostingSettings.findUnique
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ standard_monthly_hours: 176, labour_overhead_pct: 15 });

            const saved = await service.updateSettings('tenant-1', { standardMonthlyHours: 176, overheadPct: 15 }, { userId: 'owner' });

            expect(saved).toEqual({ standardMonthlyHours: 176, overheadPct: 15, billingProductId: null });
            expect(db.projectCostingSettings.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: 'tenant-1' } }),
            );
            expect(audit.log).toHaveBeenCalledWith(
                'PROJECT_COSTING_SETTINGS_UPDATED',
                'ProjectCostingSettings',
                expect.anything(),
                'tenant-1',
                { before: { standardMonthlyHours: 208, overheadPct: 0 }, after: { standardMonthlyHours: 176, overheadPct: 15 } },
            );
        });

        it('refuses hours or overhead outside what a month can hold', async () => {
            await expect(service.updateSettings('t', { standardMonthlyHours: 0, overheadPct: 0 }, {})).rejects.toThrow(BadRequestException);
            await expect(service.updateSettings('t', { standardMonthlyHours: 208, overheadPct: -1 }, {})).rejects.toThrow(BadRequestException);
        });
    });
});
