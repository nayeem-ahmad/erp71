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
                update: jest.fn().mockResolvedValue({}),
            },
            projectBudgetLine: {
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            sale: { findMany: jest.fn().mockResolvedValue([]) },
            salesReturn: { findMany: jest.fn().mockResolvedValue([]) },
            projectTimeEntry: {
                groupBy: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            projectTask: {
                groupBy: jest.fn().mockResolvedValue([
                    { assignee_id: null, assignee_employee_id: null, _sum: { remaining_hours: new Prisma.Decimal(10) } },
                ]),
            },
            projectCostEntry: { findMany: jest.fn().mockResolvedValue([]) },
            projectMaterialIssue: { findMany: jest.fn().mockResolvedValue([]) },
            expenseEntry: { findMany: jest.fn().mockResolvedValue([]) },
            projectCostingSettings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
            employee: { findMany: jest.fn(), findFirst: jest.fn() },
            employeeCostRate: { findMany: jest.fn().mockResolvedValue([]) },
            user: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(db) : Promise.all(arg))),
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
                unratedHours: 0,
                remainingDirectCost: 0,
                estimateAtCompletion: 6000,
                byPerson: [
                    { key: 'unassigned', name: '', employeeId: null, remainingHours: 10, rate: 250, rateSource: 'AVERAGE', cost: 2500 },
                ],
            });
            expect(db.projectTask.groupBy).toHaveBeenCalledWith(
                expect.objectContaining({
                    by: ['assignee_id', 'assignee_employee_id'],
                    where: expect.objectContaining({ deleted_at: null, status: { category: { not: 'DONE' } } }),
                }),
            );
        });

        it('prices the rest of the work at each assignee\'s own rate today, falling back to the project average', async () => {
            const people = [
                { id: 'e1', name: 'Karim', employee_code: 'EMP-1', user_id: 'u1', basic_salary: null },
                { id: 'e2', name: 'Abdul', employee_code: 'EMP-2', user_id: 'u2', basic_salary: new Prisma.Decimal(41600) },
                { id: 'e3', name: 'Rina', employee_code: 'EMP-3', user_id: 'u9', basic_salary: null },
            ];
            db.employee.findMany.mockImplementation(async ({ where }: any) =>
                people.filter((row) => (where.id ? where.id.in.includes(row.id) : where.user_id.in.includes(row.user_id))),
            );
            db.user.findMany.mockImplementation(async ({ where }: any) =>
                [{ id: 'u3', name: null, email: 'temp@example.com' }, { id: 'u7', name: 'Shopfloor tablet', email: 'tab@example.com' }]
                    .filter((row) => where.id.in.includes(row.id)),
            );
            db.employeeCostRate.findMany.mockResolvedValue([
                { employee_id: 'e1', hourly_cost: new Prisma.Decimal(300), effective_from: day('2026-01-01') },
            ]);
            db.projectTask.groupBy.mockResolvedValue([
                // Assigned to Karim's card: his explicit rate.
                { assignee_id: null, assignee_employee_id: 'e1', _sum: { remaining_hours: new Prisma.Decimal(4) } },
                // Assigned to Abdul's login: priced as his card, salary ÷ 208 h.
                { assignee_id: 'u2', assignee_employee_id: null, _sum: { remaining_hours: new Prisma.Decimal(3) } },
                // Rina has a card but nothing prices it; the tablet login has no card.
                { assignee_id: 'u9', assignee_employee_id: null, _sum: { remaining_hours: new Prisma.Decimal(2) } },
                { assignee_id: 'u7', assignee_employee_id: null, _sum: { remaining_hours: new Prisma.Decimal(1) } },
                { assignee_id: null, assignee_employee_id: null, _sum: { remaining_hours: new Prisma.Decimal(5) } },
                // An open task with nothing left adds nobody.
                { assignee_id: 'u3', assignee_employee_id: null, _sum: { remaining_hours: null } },
            ]);

            const result = await service.financials(OWNER, 'p1');

            expect(result.forecast.byPerson.map((row) => [row.key, row.name, row.remainingHours, row.rate, row.rateSource, row.cost])).toEqual([
                ['unassigned', '', 5, 250, 'AVERAGE', 1250],
                ['employee:e1', 'Karim', 4, 300, 'PERSON', 1200],
                ['employee:e2', 'Abdul', 3, 200, 'PERSON', 600],
                ['employee:e3', 'Rina', 2, 250, 'AVERAGE', 500],
                ['user:u7', 'Shopfloor tablet', 1, 250, 'AVERAGE', 250],
            ]);
            expect(result.forecast).toEqual(expect.objectContaining({
                remainingHours: 15,
                estimatedRemainingCost: 3800,
                unratedHours: 0,
                estimateAtCompletion: 7300,
            }));
        });

        it('counts the rest apart, never as free, while there is no rate to price it at', async () => {
            db.projectTimeEntry.groupBy.mockReset()
                .mockResolvedValueOnce([{ employee_id: null, user_id: 'u3', _sum: { hours: 4, cost_amount: null } }])
                .mockResolvedValueOnce([{ employee_id: null, user_id: 'u3', _sum: { hours: 4 } }])
                .mockResolvedValueOnce([]);

            const result = await service.financials(OWNER, 'p1');

            expect(result.totals.averageRate).toBeNull();
            expect(result.forecast).toEqual(expect.objectContaining({
                remainingHours: 10,
                estimatedRemainingCost: 0,
                unratedHours: 10,
                estimateAtCompletion: 0,
            }));
            expect(result.forecast.byPerson[0]).toEqual(expect.objectContaining({ rate: null, rateSource: null, cost: null }));
        });

        it('compares each category with its budget line, and forecasts what each budgeted category has left', async () => {
            db.projectBudgetLine.findMany.mockResolvedValue([
                { category: 'LABOUR', amount: new Prisma.Decimal(5000) },
                { category: 'MATERIAL', amount: new Prisma.Decimal(2000) },
                { category: 'OVERHEAD', amount: new Prisma.Decimal(1000) },
            ]);
            db.projectCostEntry.findMany.mockResolvedValue([
                { category: 'SERVICES', amount: new Prisma.Decimal(1000), cost_date: day('2026-08-10') },
            ]);
            db.projectMaterialIssue.findMany.mockResolvedValue([
                { issue_date: day('2026-09-02'), lines: [{ line_cost: new Prisma.Decimal(500) }] },
            ]);

            const result = await service.financials(OWNER, 'p1');

            expect(result.budgetByCategory).toBe(true);
            // The lines' sum, not the project's stored 10,000.
            expect(result.totals).toEqual(expect.objectContaining({ budget: 8000, totalCost: 5000, budgetUsedPct: 62.5, budgetRemaining: 3000 }));
            expect(result.byCategory).toEqual([
                { category: 'LABOUR', amount: 3500, budget: 5000, remaining: 1500, usedPct: 70 },
                { category: 'MATERIAL', amount: 500, budget: 2000, remaining: 1500, usedPct: 25 },
                // Spent with no budget line: shown, with nothing to compare.
                { category: 'SERVICES', amount: 1000, budget: null, remaining: null, usedPct: null },
                // Budgeted, nothing spent yet.
                { category: 'OVERHEAD', amount: 0, budget: 1000, remaining: 1000, usedPct: 0 },
            ]);
            // Labour to come is priced from hours, not the labour line; the
            // other budgeted categories forecast what they have left.
            expect(result.forecast).toEqual(expect.objectContaining({
                estimatedRemainingCost: 2500,
                remainingDirectCost: 2500,
                estimateAtCompletion: 10000,
            }));
        });

        it('never forecasts a saving from an overspent category', async () => {
            db.projectBudgetLine.findMany.mockResolvedValue([{ category: 'MATERIAL', amount: new Prisma.Decimal(100) }]);
            db.projectMaterialIssue.findMany.mockResolvedValue([
                { issue_date: day('2026-09-02'), lines: [{ line_cost: new Prisma.Decimal(500) }] },
            ]);

            const result = await service.financials(OWNER, 'p1');

            expect(result.byCategory.find((row) => row.category === 'MATERIAL')).toEqual(
                { category: 'MATERIAL', amount: 500, budget: 100, remaining: -400, usedPct: 500 },
            );
            expect(result.forecast.remainingDirectCost).toBe(0);
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
                    // By cost: 3,500 of an expected 6,000 is 58.33% of the job,
                    // which has earned that share of the 12,000 contract — so
                    // the 5,000 billed is 2,000 behind the work.
                    percentComplete: 58.33,
                    earnedRevenue: 7000,
                    earnedMargin: 3500,
                    billedAheadOfWork: -2000,
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
                    // Percent complete is a fixed-price measure.
                    percentComplete: null,
                    earnedRevenue: null,
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
                { category: 'LABOUR', amount: 3500, budget: null, remaining: null, usedPct: null },
                { category: 'MATERIAL', amount: 500, budget: null, remaining: null, usedPct: null },
                { category: 'SERVICES', amount: 1000, budget: null, remaining: null, usedPct: null },
                { category: 'EXPENSE', amount: 200, budget: null, remaining: null, usedPct: null },
            ]);
            expect(result.budgetByCategory).toBe(false);
            // With no budget by category, other costs forecast nothing further.
            expect(result.forecast.remainingDirectCost).toBe(0);
            expect(result.forecast.estimateAtCompletion).toBe(7700); // 5,200 so far + 2,500 labour to come
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

    describe('setBudget', () => {
        it('replaces the lines, drops zero ones, and writes their sum to the project in one transaction', async () => {
            db.projectBudgetLine.findMany.mockResolvedValue([{ category: 'LABOUR', amount: new Prisma.Decimal(4000) }]);

            const result = await service.setBudget(OWNER, 'p1', [
                { category: 'LABOUR', amount: 5000 },
                { category: 'MATERIAL', amount: 2500.5 },
                { category: 'OTHER', amount: 0 },
            ], { userId: 'owner' });

            expect(result).toEqual({
                lines: [{ category: 'LABOUR', amount: 5000 }, { category: 'MATERIAL', amount: 2500.5 }],
                total: 7500.5,
            });
            expect(db.$transaction).toHaveBeenCalledTimes(1);
            expect(db.projectBudgetLine.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 'tenant-1', project_id: 'p1' } });
            expect(db.projectBudgetLine.createMany).toHaveBeenCalledWith({
                data: [
                    { tenant_id: 'tenant-1', project_id: 'p1', category: 'LABOUR', amount: 5000, updated_by: 'owner' },
                    { tenant_id: 'tenant-1', project_id: 'p1', category: 'MATERIAL', amount: 2500.5, updated_by: 'owner' },
                ],
            });
            expect(db.project.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { budget_amount: 7500.5 } });
            expect(audit.log).toHaveBeenCalledWith('PROJECT_BUDGET_UPDATED', 'Project', expect.anything(), 'p1', {
                before: [{ category: 'LABOUR', amount: 4000 }],
                after: result.lines,
            });
        });

        it('clearing every line leaves the project\'s single budget figure alone', async () => {
            const result = await service.setBudget(OWNER, 'p1', [], { userId: 'owner' });

            expect(result).toEqual({ lines: [], total: null });
            expect(db.projectBudgetLine.deleteMany).toHaveBeenCalled();
            expect(db.project.update).not.toHaveBeenCalled();
        });

        it('refuses a category twice, an unknown one, or a negative amount', async () => {
            await expect(service.setBudget(OWNER, 'p1', [
                { category: 'LABOUR', amount: 1 }, { category: 'LABOUR', amount: 2 },
            ], {})).rejects.toThrow(BadRequestException);
            await expect(service.setBudget(OWNER, 'p1', [{ category: 'TRAVEL' as any, amount: 1 }], {})).rejects.toThrow(BadRequestException);
            await expect(service.setBudget(OWNER, 'p1', [{ category: 'OTHER', amount: -1 }], {})).rejects.toThrow(BadRequestException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('is no wider than the project', async () => {
            access.assertProjectVisible.mockRejectedValue(new NotFoundException('Project not found'));

            await expect(service.setBudget(OWNER, 'p-private', [], {})).rejects.toThrow(NotFoundException);
            expect(db.projectBudgetLine.deleteMany).not.toHaveBeenCalled();
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
