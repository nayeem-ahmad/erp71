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
    let service: ProjectCostingService;

    beforeEach(() => {
        db = {
            project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', code: 'BS23', name: 'Fit-out', budget_amount: new Prisma.Decimal(10000) }) },
            projectTimeEntry: {
                groupBy: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            projectTask: { aggregate: jest.fn().mockResolvedValue({ _sum: { remaining_hours: new Prisma.Decimal(10) } }) },
            projectCostingSettings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
            employee: { findMany: jest.fn(), findFirst: jest.fn() },
            employeeCostRate: { findMany: jest.fn().mockResolvedValue([]) },
            user: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
        };
        access = { assertProjectVisible: jest.fn().mockResolvedValue({ id: 'p1' }) };
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        service = new ProjectCostingService(db, access as any, new LabourPricingService(db), audit as any);
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
                budget: 10000,
                budgetUsedPct: 35,
                budgetRemaining: 6500,
                averageRate: 250,
            });
            expect(result.uncosted).toEqual({ noEmployeeHours: 4, noRateHours: 1 });
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
                { month: '2026-08', hours: 15, labourCost: 3000 },
                { month: '2026-09', hours: 4, labourCost: 500 },
            ]);
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

            expect(saved).toEqual({ standardMonthlyHours: 176, overheadPct: 15 });
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
