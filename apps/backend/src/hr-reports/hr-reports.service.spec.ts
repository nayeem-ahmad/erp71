import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { FALLBACK_SCHEDULED_DAYS, HrReportsService } from './hr-reports.service';
import { HrReportGroupByDto } from './hr-reports.dto';

const OWNER = { tenantId: 'tenant-1', userId: 'user-1', userRole: 'OWNER', storeId: 'store-1' } as any;
const STAFF = { tenantId: 'tenant-1', userId: 'user-2', userRole: 'STAFF', storeId: 'store-1' } as any;

function employee(overrides: Record<string, any> = {}) {
    return {
        id: 'emp-1',
        name: 'Rina Akter',
        employee_code: 'EMP-001',
        status: 'ACTIVE',
        department: { id: 'dept-1', name: 'Sales' },
        designation: { id: 'desig-1', name: 'Cashier' },
        ...overrides,
    };
}

function snapshot(overrides: Record<string, any> = {}) {
    return {
        year: 2026,
        month: 3,
        scheduled_days: 26,
        present_days: 24,
        absent_days: 1,
        half_days: 0,
        leave_days: 1,
        holiday_days: 4,
        late_days: 3,
        worked_minutes: 11_520,
        late_minutes: 45,
        approved_overtime_minutes: 120,
        frozen_at: null,
        employee: employee(),
        ...overrides,
    };
}

function payrollLine(overrides: Record<string, any> = {}) {
    return {
        employee_id: 'emp-1',
        gross_earnings: 30_000,
        overtime_amount: 1_000,
        absence_deduction: 1_153.85,
        structure_deductions: 2_000,
        adjustment_earnings: 0,
        adjustment_deductions: 0,
        total_deductions: 3_153.85,
        net_pay: 27_846.15,
        approved_overtime_minutes: 120,
        employee: employee(),
        run: { year: 2026, month: 3, kind: 'REGULAR', status: 'PAID' },
        ...overrides,
    };
}

describe('HrReportsService', () => {
    let service: HrReportsService;
    let db: any;

    beforeEach(async () => {
        db = {
            attendanceMonthSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
            leaveBalance: { findMany: jest.fn().mockResolvedValue([]) },
            payrollLine: { findMany: jest.fn().mockResolvedValue([]) },
            salaryComponent: { findMany: jest.fn().mockResolvedValue([]) },
            employeeSalaryStructure: { findMany: jest.fn().mockResolvedValue([]) },
            employee: { findMany: jest.fn().mockResolvedValue([]) },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [HrReportsService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(HrReportsService);
    });

    describe('monthRangeWhere', () => {
        it('bounds both ends on one clause when the range stays inside a year', () => {
            expect(HrReportsService.monthRangeWhere({ year: 2026, month: 2 }, { year: 2026, month: 5 }))
                .toEqual({ year: 2026, month: { gte: 2, lte: 5 } });
        });

        it('splits into head, tail and whole years when the range crosses a year', () => {
            const where: any = HrReportsService.monthRangeWhere(
                { year: 2025, month: 11 },
                { year: 2027, month: 2 },
            );
            expect(where.OR).toEqual([
                { year: { gt: 2025, lt: 2027 } },
                { year: 2025, month: { gte: 11 } },
                { year: 2027, month: { lte: 2 } },
            ]);
        });
    });

    describe('attendanceSummary', () => {
        it('rolls snapshots up per employee and derives the attendance rate', async () => {
            db.attendanceMonthSnapshot.findMany.mockResolvedValue([
                snapshot(),
                snapshot({ month: 4, present_days: 20, absent_days: 2, scheduled_days: 25 }),
            ]);

            const result = await service.attendanceSummary('tenant-1', {
                fromYear: 2026, fromMonth: 3, toYear: 2026, toMonth: 4,
            } as any);

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].label).toBe('Rina Akter');
            expect(result.rows[0].sublabel).toBe('EMP-001');
            expect(result.rows[0].presentDays).toBe(44);
            expect(result.rows[0].scheduledDays).toBe(51);
            expect(result.rows[0].workedHours).toBe(384);
            expect(result.rows[0].overtimeHours).toBe(4);
            expect(result.rows[0].attendanceRate).toBeCloseTo(86.27, 1);
            expect(result.summary.employees).toBe(1);
            expect(result.summary.employeeMonths).toBe(2);
        });

        it('groups by department, folding employees without one into Unassigned', async () => {
            db.attendanceMonthSnapshot.findMany.mockResolvedValue([
                snapshot(),
                snapshot({ employee: employee({ id: 'emp-2', name: 'Karim', department: null }) }),
            ]);

            const result = await service.attendanceSummary('tenant-1', {
                fromYear: 2026, fromMonth: 3, toYear: 2026, toMonth: 3,
                groupBy: HrReportGroupByDto.DEPARTMENT,
            } as any);

            expect(result.rows.map((row) => row.label).sort()).toEqual(['Sales', 'Unassigned']);
        });

        it('counts the months payroll has frozen', async () => {
            db.attendanceMonthSnapshot.findMany.mockResolvedValue([
                snapshot({ frozen_at: new Date('2026-04-01') }),
                snapshot({ month: 4 }),
            ]);

            const result = await service.attendanceSummary('tenant-1', {
                fromYear: 2026, fromMonth: 3, toYear: 2026, toMonth: 4,
            } as any);

            expect(result.summary.frozenMonths).toBe(1);
        });

        it('swaps a range that arrives backwards rather than returning nothing', async () => {
            await service.attendanceSummary('tenant-1', {
                fromYear: 2026, fromMonth: 6, toYear: 2026, toMonth: 2,
            } as any);

            const where = db.attendanceMonthSnapshot.findMany.mock.calls[0][0].where;
            expect(where).toMatchObject({ year: 2026, month: { gte: 2, lte: 6 } });
        });

        it('scopes every query to the tenant', async () => {
            await service.attendanceSummary('tenant-1', {
                fromYear: 2026, fromMonth: 3, toYear: 2026, toMonth: 3,
            } as any);

            expect(db.attendanceMonthSnapshot.findMany.mock.calls[0][0].where.tenant_id).toBe('tenant-1');
        });
    });

    describe('leaveBalance', () => {
        const balance = (overrides: Record<string, any> = {}) => ({
            employee_id: 'emp-1',
            leave_type_id: 'lt-1',
            total_days: 18,
            used_days: 6,
            employee: employee(),
            leave_type: {
                id: 'lt-1', name: 'Annual', allows_encashment: true, carry_forward_max_days: 10,
            },
            ...overrides,
        });

        it('prices remaining encashable days at gross over the real scheduled days', async () => {
            db.leaveBalance.findMany.mockResolvedValue([balance()]);
            db.salaryComponent.findMany.mockResolvedValue([
                { id: 'c-basic', name: 'Basic', kind: 'EARNING', calculation: 'FIXED', is_basic: true, is_taxable: true, sort_order: 0 },
            ]);
            db.employee.findMany.mockResolvedValue([{ id: 'emp-1', basic_salary: 26_000 }]);
            db.attendanceMonthSnapshot.findMany.mockResolvedValue([
                { employee_id: 'emp-1', scheduled_days: 26, year: 2026, month: 3 },
            ]);

            const result = await service.leaveBalance(OWNER, { year: 2026 } as any);

            expect(result.rows[0].remainingDays).toBe(12);
            expect(result.rows[0].dailyRate).toBe(1_000);
            expect(result.rows[0].dailyRateSource).toBe('BASIC_SALARY');
            expect(result.rows[0].liability).toBe(12_000);
            expect(result.summary.liability).toBe(12_000);
            expect(result.summary.encashableDays).toBe(12);
        });

        it('falls back to a stated working-day count when the employee has no snapshot', async () => {
            db.leaveBalance.findMany.mockResolvedValue([balance()]);
            db.salaryComponent.findMany.mockResolvedValue([
                { id: 'c-basic', name: 'Basic', kind: 'EARNING', calculation: 'FIXED', is_basic: true, is_taxable: true, sort_order: 0 },
            ]);
            db.employee.findMany.mockResolvedValue([{ id: 'emp-1', basic_salary: 26_000 }]);
            db.attendanceMonthSnapshot.findMany.mockResolvedValue([]);

            const result = await service.leaveBalance(OWNER, { year: 2026 } as any);

            expect(result.rows[0].dailyRate).toBe(26_000 / FALLBACK_SCHEDULED_DAYS);
            expect(result.rows[0].dailyRateSource).toBe('BASIC_SALARY_FALLBACK_DAYS');
        });

        it('never prices a type that cannot be encashed', async () => {
            db.leaveBalance.findMany.mockResolvedValue([
                balance({
                    leave_type: {
                        id: 'lt-2', name: 'Sick', allows_encashment: false, carry_forward_max_days: null,
                    },
                }),
            ]);
            db.salaryComponent.findMany.mockResolvedValue([
                { id: 'c-basic', name: 'Basic', kind: 'EARNING', calculation: 'FIXED', is_basic: true, is_taxable: true, sort_order: 0 },
            ]);
            db.employee.findMany.mockResolvedValue([{ id: 'emp-1', basic_salary: 26_000 }]);

            const result = await service.leaveBalance(OWNER, { year: 2026 } as any);

            expect(result.rows[0].liability).toBeNull();
            expect(result.summary.liability).toBe(0);
        });

        it('treats an overdrawn balance as zero liability, not a negative one', async () => {
            db.leaveBalance.findMany.mockResolvedValue([
                balance({ total_days: 5, used_days: 8 }),
            ]);
            db.salaryComponent.findMany.mockResolvedValue([
                { id: 'c-basic', name: 'Basic', kind: 'EARNING', calculation: 'FIXED', is_basic: true, is_taxable: true, sort_order: 0 },
            ]);
            db.employee.findMany.mockResolvedValue([{ id: 'emp-1', basic_salary: 26_000 }]);
            db.attendanceMonthSnapshot.findMany.mockResolvedValue([
                { employee_id: 'emp-1', scheduled_days: 26, year: 2026, month: 3 },
            ]);

            const result = await service.leaveBalance(OWNER, { year: 2026 } as any);

            expect(result.rows[0].remainingDays).toBe(-3);
            expect(result.rows[0].liability).toBe(0);
            expect(result.summary.liability).toBe(0);
        });

        it('drops every money column for a caller without VIEW_PAYROLL', async () => {
            db.leaveBalance.findMany.mockResolvedValue([balance()]);

            const result = await service.leaveBalance(STAFF, { year: 2026 } as any);

            expect(result.can_view_payroll).toBe(false);
            expect(result.rows[0].remainingDays).toBe(12);
            expect(result.rows[0].dailyRate).toBeNull();
            expect(result.rows[0].liability).toBeNull();
            expect(result.summary.liability).toBeNull();
            // The rate lookup must not even run — it reads salary structures.
            expect(db.salaryComponent.findMany).not.toHaveBeenCalled();
        });

        it('reports how many encashable rows it could not price', async () => {
            db.leaveBalance.findMany.mockResolvedValue([balance()]);
            db.salaryComponent.findMany.mockResolvedValue([]);
            db.employee.findMany.mockResolvedValue([{ id: 'emp-1', basic_salary: null }]);

            const result = await service.leaveBalance(OWNER, { year: 2026 } as any);

            expect(result.rows[0].dailyRate).toBeNull();
            expect(result.summary.unpricedRows).toBe(1);
        });
    });

    describe('payrollCost', () => {
        it('reads settled runs only', async () => {
            await service.payrollCost('tenant-1', {
                fromYear: 2026, fromMonth: 1, toYear: 2026, toMonth: 3,
            } as any);

            const where = db.payrollLine.findMany.mock.calls[0][0].where;
            expect(where.run.status).toEqual({ in: ['APPROVED', 'PAID'] });
            expect(where.tenant_id).toBe('tenant-1');
        });

        it('rolls cost up by department and shares it against the net total', async () => {
            db.payrollLine.findMany.mockResolvedValue([
                payrollLine(),
                payrollLine({
                    employee_id: 'emp-2',
                    net_pay: 9_282.05,
                    gross_earnings: 10_000,
                    employee: employee({
                        id: 'emp-2', name: 'Karim', department: { id: 'dept-2', name: 'Warehouse' },
                    }),
                }),
            ]);

            const result = await service.payrollCost('tenant-1', {
                fromYear: 2026, fromMonth: 3, toYear: 2026, toMonth: 3,
                groupBy: HrReportGroupByDto.DEPARTMENT,
            } as any);

            expect(result.rows.map((row) => row.label)).toEqual(['Sales', 'Warehouse']);
            expect(result.rows[0].netPay).toBe(27_846.15);
            expect(result.rows[0].share).toBeCloseTo(75, 0);
            expect(result.summary.netPay).toBe(37_128.2);
            expect(result.summary.employees).toBe(2);
            expect(result.summary.averagePerEmployee).toBe(18_564.1);
        });

        it('compares the two most recent months that have a settled run', async () => {
            db.payrollLine.findMany.mockResolvedValue([
                payrollLine({ net_pay: 20_000, run: { year: 2026, month: 1, kind: 'REGULAR', status: 'PAID' } }),
                payrollLine({ net_pay: 25_000, run: { year: 2026, month: 3, kind: 'REGULAR', status: 'PAID' } }),
            ]);

            const result = await service.payrollCost('tenant-1', {
                fromYear: 2026, fromMonth: 1, toYear: 2026, toMonth: 3,
            } as any);

            expect(result.summary.latestMonth).toBe('2026-03');
            expect(result.summary.latestMonthNet).toBe(25_000);
            expect(result.summary.previousMonthNet).toBe(20_000);
            expect(result.summary.monthOverMonth).toBe(25);
        });

        it('reports no movement rather than a division by zero on a single month', async () => {
            db.payrollLine.findMany.mockResolvedValue([payrollLine()]);

            const result = await service.payrollCost('tenant-1', {
                fromYear: 2026, fromMonth: 3, toYear: 2026, toMonth: 3,
            } as any);

            expect(result.summary.previousMonthNet).toBeNull();
            expect(result.summary.monthOverMonth).toBeNull();
        });

        it('sorts month groupings chronologically, not by size', async () => {
            db.payrollLine.findMany.mockResolvedValue([
                payrollLine({ net_pay: 5_000, run: { year: 2026, month: 3, kind: 'REGULAR', status: 'PAID' } }),
                payrollLine({ net_pay: 90_000, run: { year: 2026, month: 1, kind: 'REGULAR', status: 'PAID' } }),
            ]);

            const result = await service.payrollCost('tenant-1', {
                fromYear: 2026, fromMonth: 1, toYear: 2026, toMonth: 3,
                groupBy: HrReportGroupByDto.MONTH,
            } as any);

            expect(result.rows.map((row) => row.label)).toEqual(['2026-01', '2026-03']);
        });

        it('returns empty rows and a null movement when nothing is settled', async () => {
            const result = await service.payrollCost('tenant-1', {
                fromYear: 2026, fromMonth: 1, toYear: 2026, toMonth: 3,
            } as any);

            expect(result.rows).toEqual([]);
            expect(result.summary.netPay).toBe(0);
            expect(result.summary.averagePerEmployee).toBeNull();
            expect(result.summary.monthOverMonth).toBeNull();
        });
    });
});
