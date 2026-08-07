import { Test, TestingModule } from '@nestjs/testing';
import { StatutoryReportsService } from './statutory-reports.service';
import { DatabaseService } from '../database/database.service';

const employee = (id: string, name: string) => ({
    id, name, employee_code: `EMP-${id}`, date_of_joining: new Date('2024-01-01'),
    department: { name: 'Sales' }, designation: { name: 'Executive' },
});

const line = (over: Record<string, any> = {}) => ({
    employee_id: 'e1',
    employee: employee('e1', 'Alice'),
    run: { year: 2026, month: 8, kind: 'REGULAR' },
    gross_earnings: 30000,
    total_deductions: 2000,
    net_pay: 28000,
    scheduled_days: 22,
    present_days: 22,
    approved_overtime_minutes: 0,
    items: [
        { kind: 'EARNING', name: 'Basic', amount: 20000, sort_order: 0 },
        { kind: 'DEDUCTION', name: 'Provident Fund', amount: 1000, sort_order: 300 },
        { kind: 'DEDUCTION', name: 'Income Tax', amount: 1000, sort_order: 301 },
    ],
    ...over,
});

describe('StatutoryReportsService', () => {
    let service: StatutoryReportsService;
    let db: any;

    beforeEach(async () => {
        db = {
            payrollLine: { findMany: jest.fn().mockResolvedValue([]) },
            employee: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
            employeeSalaryStructure: { findMany: jest.fn().mockResolvedValue([]) },
            leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [StatutoryReportsService, { provide: DatabaseService, useValue: db }],
        }).compile();
        service = module.get(StatutoryReportsService);
    });

    describe('fiscalYearRange', () => {
        it('runs July to June, not January to December', () => {
            // Getting this wrong makes every tax figure a year out, which is
            // why it is a named function rather than an inline calculation.
            const range = StatutoryReportsService.fiscalYearRange(2026);
            expect(range.from).toEqual({ year: 2026, month: 7 });
            expect(range.to).toEqual({ year: 2027, month: 6 });
        });

        it('labels the year the way a Bangladeshi form does', () => {
            expect(StatutoryReportsService.fiscalYearRange(2026).label).toBe('2026-27');
            expect(StatutoryReportsService.fiscalYearRange(2029).label).toBe('2029-30');
        });
    });

    describe('source data', () => {
        it('reads only approved and paid runs, never drafts', async () => {
            // A statutory return that changes because HR edited a draft is
            // worse than no return.
            await service.wagesRegister('t1', 2026, 8);
            expect(db.payrollLine.findMany.mock.calls[0][0].where.run.status)
                .toEqual({ in: ['APPROVED', 'PAID'] });
        });
    });

    describe('providentFundRegister', () => {
        it('sums the PF deduction per employee across the year', async () => {
            db.payrollLine.findMany.mockResolvedValue([
                line(), line({ run: { year: 2026, month: 9, kind: 'REGULAR' } }),
            ]);

            const report = await service.providentFundRegister('t1', 2026);

            expect(report.rows).toHaveLength(1);
            expect(report.rows[0].total_employee_contribution).toBe(2000);
            expect(report.grand_total).toBe(2000);
        });

        it('matches a PF line by name, however the tenant spelled it', async () => {
            // Forcing a system flag onto the component would mean a tenant who
            // named it differently silently files an empty register.
            db.payrollLine.findMany.mockResolvedValue([
                line({ items: [{ kind: 'DEDUCTION', name: 'PF', amount: 500 }] }),
            ]);
            const report = await service.providentFundRegister('t1', 2026);
            expect(report.grand_total).toBe(500);
        });

        it('excludes an employee with no PF deduction', async () => {
            db.payrollLine.findMany.mockResolvedValue([
                line({ items: [{ kind: 'DEDUCTION', name: 'Income Tax', amount: 1000 }] }),
            ]);
            const report = await service.providentFundRegister('t1', 2026);
            expect(report.rows).toHaveLength(0);
        });

        it('says the employer contribution is not modelled', async () => {
            // Showing a fabricated match would be worse than showing only what
            // was actually withheld.
            const report = await service.providentFundRegister('t1', 2026);
            expect(report.notes.join(' ')).toMatch(/employer matching contribution is not recorded/i);
        });
    });

    describe('taxDeductionStatement', () => {
        it('sums withheld tax and gross across the income year', async () => {
            db.payrollLine.findMany.mockResolvedValue([line(), line()]);
            const report = await service.taxDeductionStatement('t1', 2026);
            expect(report.totals.tax_deducted).toBe(2000);
            expect(report.totals.gross_earnings).toBe(60000);
            expect(report.rows[0].months).toBe(2);
        });

        it('reports zero tax for an employee with no tax line, rather than dropping them', async () => {
            // Somebody below the threshold still belongs on the statement.
            db.payrollLine.findMany.mockResolvedValue([
                line({ items: [{ kind: 'DEDUCTION', name: 'Provident Fund', amount: 1000 }] }),
            ]);
            const report = await service.taxDeductionStatement('t1', 2026);
            expect(report.rows).toHaveLength(1);
            expect(report.rows[0].tax_deducted).toBe(0);
        });

        it('states that it reports withholding and does not compute liability', async () => {
            // Slabs, rebates and thresholds move by Finance Act; a number this
            // system calculated would be wrong and look authoritative.
            const report = await service.taxDeductionStatement('t1', 2026);
            expect(report.notes.join(' ')).toMatch(/does not compute liability/i);
        });
    });

    describe('wagesRegister', () => {
        it('splits earnings and deductions per employee', async () => {
            db.payrollLine.findMany.mockResolvedValue([line()]);
            const report = await service.wagesRegister('t1', 2026, 8);

            expect(report.rows[0].earnings).toEqual([{ name: 'Basic', amount: 20000 }]);
            expect(report.rows[0].deductions.map((d: any) => d.name))
                .toEqual(['Provident Fund', 'Income Tax']);
        });

        it('totals the month', async () => {
            db.payrollLine.findMany.mockResolvedValue([line(), line({ employee_id: 'e2' })]);
            const report = await service.wagesRegister('t1', 2026, 8);
            expect(report.totals.net_pay).toBe(56000);
        });

        it('carries the attendance figures the register asks for', async () => {
            db.payrollLine.findMany.mockResolvedValue([line({ present_days: 20, approved_overtime_minutes: 120 })]);
            const report = await service.wagesRegister('t1', 2026, 8);
            expect(report.rows[0].present_days).toBe(20);
            expect(report.rows[0].overtime_minutes).toBe(120);
        });
    });

    describe('employeeRegister', () => {
        it('includes leavers with their reason and last day', async () => {
            // A register showing only current staff is exactly wrong for an
            // inspection covering a past period.
            db.employee.findMany.mockResolvedValue([
                {
                    employee_code: 'E1', name: 'Alice', phone: '017', date_of_joining: new Date(),
                    status: 'RESIGNED', last_working_day: new Date(), exit_reason: 'Better offer',
                    department: { name: 'Sales' }, designation: { name: 'Executive' },
                },
            ]);

            const report = await service.employeeRegister('t1');

            expect(report.rows[0].status).toBe('RESIGNED');
            expect(report.rows[0].exit_reason).toBe('Better offer');
        });

        it('never exports the NID', async () => {
            // Encrypted at rest, and a spreadsheet is the last place it should
            // surface.
            db.employee.findMany.mockResolvedValue([{
                employee_code: 'E1', name: 'Alice', phone: '017', date_of_joining: new Date(),
                status: 'ACTIVE', last_working_day: null, exit_reason: null,
                department: null, designation: null,
            }]);

            const report = await service.employeeRegister('t1');

            expect(JSON.stringify(report.rows)).not.toContain('nid');
            expect(db.employee.findMany.mock.calls[0][0].select).not.toHaveProperty('nid');
            expect(report.notes.join(' ')).toMatch(/encrypted/i);
        });
    });

    describe('serviceBook', () => {
        it('returns null for an employee outside the tenant', async () => {
            expect(await service.serviceBook('t1', 'emp-x')).toBeNull();
        });

        it('assembles revisions, leave and months paid', async () => {
            db.employee.findFirst.mockResolvedValue(employee('e1', 'Alice'));
            db.employeeSalaryStructure.findMany.mockResolvedValue([
                { effective_from: new Date('2026-01-01'), note: 'Joining', lines: [{}, {}] },
            ]);
            db.leaveRequest.findMany.mockResolvedValue([
                { leave_type: { name: 'Annual' }, start_date: new Date(), end_date: new Date(), days: 3 },
            ]);
            db.payrollLine.findMany.mockResolvedValue([line(), line()]);

            const book = await service.serviceBook('t1', 'e1');

            expect(book!.salary_revisions).toHaveLength(1);
            expect(book!.total_leave_days).toBe(3);
            expect(book!.months_paid).toBe(2);
        });

        it('says designation history is not recorded rather than faking one', async () => {
            // `Employee` holds only the current assignment, so a history here
            // would be a single row pretending to be a timeline.
            db.employee.findFirst.mockResolvedValue(employee('e1', 'Alice'));
            const book = await service.serviceBook('t1', 'e1');
            expect(book!.notes.join(' ')).toMatch(/history is not recorded/i);
        });
    });
});
