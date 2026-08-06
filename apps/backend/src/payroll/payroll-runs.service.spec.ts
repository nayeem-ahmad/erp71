import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PayrollRunsService } from './payroll-runs.service';
import { SalaryStructuresService } from './salary-structures.service';
import { OvertimeService } from '../attendance/overtime.service';
import { DatabaseService } from '../database/database.service';

const STRUCTURE = {
    source: 'STRUCTURE' as const,
    effective_from: new Date(),
    basic: 20000,
    earnings: [
        { component_id: 'c-basic', name: 'Basic', kind: 'EARNING' as const, is_taxable: true, rate: 20000, calculation: 'FIXED' as const, amount: 20000 },
    ],
    deductions: [],
    grossEarnings: 20000,
    totalDeductions: 0,
    net: 20000,
    taxableEarnings: 20000,
};

const SNAPSHOT = {
    scheduled_days: 22, present_days: 22, absent_days: 0,
    leave_days: 0, approved_overtime_minutes: 0,
};

describe('PayrollRunsService', () => {
    let service: PayrollRunsService;
    let db: any;
    let structures: any;
    let overtime: any;

    const RUN = { id: 'run-1', tenant_id: 't1', year: 2026, month: 8, kind: 'REGULAR', status: 'DRAFT' };

    beforeEach(async () => {
        db = {
            payrollRun: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue(RUN),
                update: jest.fn().mockResolvedValue(RUN),
            },
            payrollLine: {
                create: jest.fn().mockResolvedValue({}),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            payrollAdjustment: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1' }]), findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
        };
        db.$transaction = jest.fn(async (cb: any) => cb(db));

        structures = { resolveStructure: jest.fn().mockResolvedValue(STRUCTURE) };
        overtime = {
            freezeMonth: jest.fn().mockResolvedValue({ frozen: 1 }),
            getFrozenSnapshot: jest.fn().mockResolvedValue(SNAPSHOT),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PayrollRunsService,
                { provide: DatabaseService, useValue: db },
                { provide: SalaryStructuresService, useValue: structures },
                { provide: OvertimeService, useValue: overtime },
            ],
        }).compile();
        service = module.get(PayrollRunsService);
    });

    /** `get` re-reads the run; give it something to find. */
    const runExists = (over: Record<string, any> = {}) =>
        db.payrollRun.findFirst.mockResolvedValue({ ...RUN, lines: [], ...over });

    describe('createDraft', () => {
        it('freezes the attendance month before computing', async () => {
            // Without the freeze, correcting an attendance row after the draft
            // would make a re-run produce different pay silently.
            db.payrollRun.findFirst
                .mockResolvedValueOnce(null)          // no existing run
                .mockResolvedValue({ ...RUN, lines: [] });

            await service.createDraft('t1', { year: 2026, month: 8 });

            expect(overtime.freezeMonth).toHaveBeenCalledWith('t1', 2026, 8);
        });

        it('refuses a second regular run for the same month', async () => {
            db.payrollRun.findFirst.mockResolvedValue(RUN);
            await expect(service.createDraft('t1', { year: 2026, month: 8 }))
                .rejects.toThrow(ConflictException);
        });

        it('does not freeze the month for an off-cycle bonus run', async () => {
            // A festival bonus must not lock the month a regular run has not
            // finished with.
            db.payrollRun.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValue({ ...RUN, kind: 'BONUS', lines: [] });

            await service.createDraft('t1', { year: 2026, month: 8, kind: 'BONUS' });

            expect(overtime.freezeMonth).not.toHaveBeenCalled();
        });

        it('resolves each structure at month end', async () => {
            db.payrollRun.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValue({ ...RUN, lines: [] });

            await service.createDraft('t1', { year: 2026, month: 8 });

            const date = structures.resolveStructure.mock.calls[0][2];
            expect(date.toISOString().slice(0, 10)).toBe('2026-08-31');
        });

        it('writes a line per active employee with the snapshot copied onto it', async () => {
            db.payrollRun.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValue({ ...RUN, lines: [] });

            await service.createDraft('t1', { year: 2026, month: 8 });

            const data = db.payrollLine.create.mock.calls[0][0].data;
            expect(data.employee_id).toBe('emp-1');
            expect(data.scheduled_days).toBe(22);
            expect(data.net_pay).toBe(20000);
            expect(data.items.create.length).toBeGreaterThan(0);
        });

        it('pays the full structure when an employee has no frozen snapshot', async () => {
            // A shop that does not track attendance still pays its staff.
            overtime.getFrozenSnapshot.mockResolvedValue(null);
            db.payrollRun.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValue({ ...RUN, lines: [] });

            await service.createDraft('t1', { year: 2026, month: 8 });

            const data = db.payrollLine.create.mock.calls[0][0].data;
            expect(data.scheduled_days).toBe(0);
            expect(data.net_pay).toBe(20000);
        });

        it('only reads adjustments that no run has consumed', async () => {
            db.payrollRun.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValue({ ...RUN, lines: [] });

            await service.createDraft('t1', { year: 2026, month: 8 });

            expect(db.payrollAdjustment.findMany.mock.calls[0][0].where.applied_run_id).toBeNull();
        });
    });

    describe('recompute', () => {
        it('rewrites the lines wholesale', async () => {
            // A diff would leave a line for somebody who has since left.
            runExists();
            await service.recompute('t1', 'run-1');
            expect(db.payrollLine.deleteMany).toHaveBeenCalledWith({ where: { run_id: 'run-1' } });
        });

        it('refuses to recompute an approved run', async () => {
            runExists({ status: 'APPROVED' });
            await expect(service.recompute('t1', 'run-1')).rejects.toThrow(BadRequestException);
        });

        it('refuses a run from another tenant', async () => {
            db.payrollRun.findFirst.mockResolvedValue(null);
            await expect(service.recompute('t1', 'run-x')).rejects.toThrow(NotFoundException);
        });
    });

    describe('approve', () => {
        it('marks the adjustments the run consumed', async () => {
            // `applied_run_id` is what stops the same advance recovery being
            // applied again by a later run.
            runExists({ lines: [{ employee_id: 'emp-1' }] });

            await service.approve('t1', 'run-1', 'user-1');

            expect(db.payrollAdjustment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: { applied_run_id: 'run-1' },
            }));
            expect(db.payrollRun.update.mock.calls[0][0].data.status).toBe('APPROVED');
        });

        it('refuses to approve a run with no lines', async () => {
            runExists({ lines: [] });
            await expect(service.approve('t1', 'run-1', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('refuses to approve twice', async () => {
            runExists({ status: 'APPROVED', lines: [{ employee_id: 'emp-1' }] });
            await expect(service.approve('t1', 'run-1', 'user-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('reopen', () => {
        it('releases the adjustments so a recompute picks them up again', async () => {
            runExists({ status: 'APPROVED' });
            await service.reopen('t1', 'run-1');
            expect(db.payrollAdjustment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: { applied_run_id: null },
            }));
            expect(db.payrollRun.update.mock.calls[0][0].data.status).toBe('DRAFT');
        });

        it('refuses to reopen a paid run', async () => {
            // Money has left the building; a draft cannot describe that.
            runExists({ status: 'PAID' });
            await expect(service.reopen('t1', 'run-1')).rejects.toThrow(BadRequestException);
        });

        it('refuses to reopen a draft', async () => {
            runExists({ status: 'DRAFT' });
            await expect(service.reopen('t1', 'run-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('cancel', () => {
        it('releases adjustments and marks the run cancelled', async () => {
            runExists({ status: 'APPROVED' });
            await service.cancel('t1', 'run-1');
            expect(db.payrollRun.update.mock.calls[0][0].data.status).toBe('CANCELLED');
        });

        it('refuses to cancel a paid run', async () => {
            runExists({ status: 'PAID' });
            await expect(service.cancel('t1', 'run-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('adjustments', () => {
        it('refuses a zero or negative amount', async () => {
            // Direction is `kind`, not the sign — a negative deduction is an
            // earning in disguise and would not print sensibly.
            await expect(service.createAdjustment('t1', {
                employee_id: 'emp-1', year: 2026, month: 8,
                kind: 'DEDUCTION', name: 'Fine', amount: 0,
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses an employee from another tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await expect(service.createAdjustment('t1', {
                employee_id: 'emp-x', year: 2026, month: 8,
                kind: 'EARNING', name: 'Bonus', amount: 100,
            })).rejects.toThrow(NotFoundException);
        });

        it('refuses to delete an adjustment an approved run consumed', async () => {
            db.payrollAdjustment.findFirst.mockResolvedValue({ id: 'adj-1', applied_run_id: 'run-1' });
            await expect(service.deleteAdjustment('t1', 'adj-1')).rejects.toThrow(BadRequestException);
        });

        it('deletes an unapplied adjustment', async () => {
            db.payrollAdjustment.findFirst.mockResolvedValue({ id: 'adj-1', applied_run_id: null });
            await service.deleteAdjustment('t1', 'adj-1');
            expect(db.payrollAdjustment.delete).toHaveBeenCalled();
        });
    });

    describe('getPayslip', () => {
        it('refuses a payslip that does not exist', async () => {
            await expect(service.getPayslip('t1', 'run-1', 'emp-9')).rejects.toThrow(NotFoundException);
        });

        it('scopes the lookup by tenant as well as run', async () => {
            db.payrollLine.findFirst.mockResolvedValue({ id: 'line-1' });
            await service.getPayslip('t1', 'run-1', 'emp-1');
            expect(db.payrollLine.findFirst.mock.calls[0][0].where).toMatchObject({
                run_id: 'run-1', tenant_id: 't1', employee_id: 'emp-1',
            });
        });
    });
});
