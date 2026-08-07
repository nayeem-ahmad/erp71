import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmployeeLifecycleService } from './employee-lifecycle.service';
import { SalaryStructuresService } from '../payroll/salary-structures.service';
import { DatabaseService } from '../database/database.service';

const STRUCTURE = {
    source: 'STRUCTURE' as const, effective_from: new Date(), basic: 20000,
    earnings: [], deductions: [], grossEarnings: 30000,
    totalDeductions: 0, net: 30000, taxableEarnings: 30000,
};

describe('EmployeeLifecycleService', () => {
    let service: EmployeeLifecycleService;
    let db: any;
    let structures: any;

    beforeEach(async () => {
        db = {
            employee: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'emp-1', name: 'Alice', status: 'ACTIVE',
                    last_working_day: new Date(Date.UTC(2026, 8, 30)),
                }),
                update: jest.fn().mockResolvedValue({ id: 'emp-1', status: 'RESIGNED' }),
            },
            checklistTemplate: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
            },
            employeeChecklistItem: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
                update: jest.fn().mockResolvedValue({}),
            },
            leaveBalance: { findMany: jest.fn().mockResolvedValue([]) },
            assetAssignment: { findMany: jest.fn().mockResolvedValue([]) },
            payrollAdjustment: {
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({}),
            },
        };
        structures = { resolveStructure: jest.fn().mockResolvedValue(STRUCTURE) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmployeeLifecycleService,
                { provide: DatabaseService, useValue: db },
                { provide: SalaryStructuresService, useValue: structures },
            ],
        }).compile();
        service = module.get(EmployeeLifecycleService);
    });

    describe('checklists', () => {
        it('copies the template titles onto the employee', async () => {
            // Copied, not referenced: retiring a template later must not
            // rewrite the history of everyone who completed it.
            db.checklistTemplate.findMany.mockResolvedValue([
                { title: 'Collect NID', description: null, sort_order: 0 },
                { title: 'Issue laptop', description: null, sort_order: 1 },
            ]);

            const result = await service.startChecklist('t1', 'emp-1', 'ONBOARDING');

            expect(result.created).toBe(2);
            expect(db.employeeChecklistItem.createMany.mock.calls[0][0].data[0].title)
                .toBe('Collect NID');
        });

        it('adds only the templates the employee does not already have', async () => {
            db.checklistTemplate.findMany.mockResolvedValue([
                { title: 'Collect NID', sort_order: 0 },
                { title: 'Issue laptop', sort_order: 1 },
            ]);
            db.employeeChecklistItem.findMany.mockResolvedValue([{ title: 'Collect NID' }]);

            const result = await service.startChecklist('t1', 'emp-1', 'ONBOARDING');

            expect(result.created).toBe(1);
            expect(db.employeeChecklistItem.createMany.mock.calls[0][0].data[0].title)
                .toBe('Issue laptop');
        });

        it('does nothing when everything is already there', async () => {
            db.checklistTemplate.findMany.mockResolvedValue([{ title: 'Collect NID', sort_order: 0 }]);
            db.employeeChecklistItem.findMany.mockResolvedValue([{ title: 'Collect NID' }]);

            const result = await service.startChecklist('t1', 'emp-1', 'ONBOARDING');

            expect(result.created).toBe(0);
            expect(db.employeeChecklistItem.createMany).not.toHaveBeenCalled();
        });

        it('deactivates a template rather than deleting it', async () => {
            db.checklistTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });
            await service.deleteTemplate('t1', 'tpl-1');
            expect(db.checklistTemplate.update.mock.calls[0][0].data).toEqual({ is_active: false });
        });

        it('is idempotent on completing an item twice', async () => {
            const done = { id: 'i-1', completed_at: new Date() };
            db.employeeChecklistItem.findFirst.mockResolvedValue(done);
            const result = await service.completeChecklistItem('t1', 'i-1', 'user-1');
            expect(result).toBe(done);
            expect(db.employeeChecklistItem.update).not.toHaveBeenCalled();
        });
    });

    describe('recordExit', () => {
        it('records the status, reason and last working day', async () => {
            await service.recordExit('t1', 'emp-1', {
                status: 'RESIGNED', last_working_day: '2026-09-30', exit_reason: 'Better offer',
            });

            const data = db.employee.update.mock.calls[0][0].data;
            expect(data.status).toBe('RESIGNED');
            expect(data.exit_reason).toBe('Better offer');
            expect(data.last_working_day.toISOString().slice(0, 10)).toBe('2026-09-30');
        });

        it('starts the offboarding checklist in the same action', async () => {
            // An exit recorded without a checklist is how an unreturned laptop
            // goes unnoticed.
            db.checklistTemplate.findMany.mockResolvedValue([{ title: 'Return laptop', sort_order: 0 }]);

            await service.recordExit('t1', 'emp-1', {
                status: 'RESIGNED', last_working_day: '2026-09-30',
            });

            expect(db.employeeChecklistItem.createMany).toHaveBeenCalled();
        });

        it('refuses to mark someone as leaving twice', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'emp-1', status: 'RESIGNED' });
            await expect(service.recordExit('t1', 'emp-1', {
                status: 'TERMINATED', last_working_day: '2026-09-30',
            })).rejects.toThrow(BadRequestException);
        });

        it('does not revoke portal access', async () => {
            // Someone working their notice still needs their own payslips;
            // access goes with the settlement, not the announcement.
            await service.recordExit('t1', 'emp-1', {
                status: 'RESIGNED', last_working_day: '2026-09-30',
            });
            expect(db.employee.update.mock.calls[0][0].data).not.toHaveProperty('portal_access');
        });

        it('refuses an employee from another tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await expect(service.recordExit('t1', 'emp-x', {
                status: 'RESIGNED', last_working_day: '2026-09-30',
            })).rejects.toThrow(NotFoundException);
        });
    });

    describe('previewFinalSettlement', () => {
        it('encashes only leave types that allow it', async () => {
            db.leaveBalance.findMany.mockResolvedValue([
                { total_days: 12, used_days: 4, leave_type: { name: 'Annual', allows_encashment: true } },
                { total_days: 10, used_days: 0, leave_type: { name: 'Sick', allows_encashment: false } },
            ]);

            const preview = await service.previewFinalSettlement('t1', 'emp-1');

            expect(preview.leave_encashment.lines).toHaveLength(1);
            expect(preview.leave_encashment.lines[0].leave_type).toBe('Annual');
            // 8 unused days at 30000/30 = 1000/day
            expect(preview.leave_encashment.total).toBe(8000);
        });

        it('skips a leave type with nothing left', async () => {
            db.leaveBalance.findMany.mockResolvedValue([
                { total_days: 12, used_days: 12, leave_type: { name: 'Annual', allows_encashment: true } },
            ]);
            const preview = await service.previewFinalSettlement('t1', 'emp-1');
            expect(preview.leave_encashment.lines).toHaveLength(0);
        });

        it('nets pending adjustments into the estimate', async () => {
            db.payrollAdjustment.findMany.mockResolvedValue([
                { kind: 'DEDUCTION', name: 'Advance', amount: 5000 },
                { kind: 'EARNING', name: 'Bonus', amount: 2000 },
            ]);

            const preview = await service.previewFinalSettlement('t1', 'emp-1');

            expect(preview.pending_adjustments.deductions).toBe(5000);
            expect(preview.pending_adjustments.earnings).toBe(2000);
            expect(preview.estimated_net).toBe(-3000);
        });

        it('reports outstanding assets as a blocker rather than refusing', async () => {
            // A business may well settle anyway and chase the laptop
            // separately; blocking that would be the system overruling a
            // judgement it is not equipped to make.
            db.assetAssignment.findMany.mockResolvedValue([
                { id: 'a-1', item_name: 'Dell Laptop', serial_number: 'X1', assigned_on: new Date() },
            ]);

            const preview = await service.previewFinalSettlement('t1', 'emp-1');

            expect(preview.blockers.outstanding_assets).toHaveLength(1);
            expect(preview.estimated_net).toBe(0);
        });

        it('reports an incomplete offboarding checklist as a blocker', async () => {
            db.employeeChecklistItem.findMany.mockResolvedValue([{ id: 'i-1', title: 'Return laptop' }]);
            const preview = await service.previewFinalSettlement('t1', 'emp-1');
            expect(preview.blockers.incomplete_checklist).toHaveLength(1);
        });

        it('resolves the structure as at the last working day', async () => {
            await service.previewFinalSettlement('t1', 'emp-1');
            const date = structures.resolveStructure.mock.calls[0][2];
            expect(date.toISOString().slice(0, 10)).toBe('2026-09-30');
        });
    });

    describe('prepareFinalSettlement', () => {
        it('creates one earning adjustment for the encashment', async () => {
            // Adjustments rather than a payment keeps settlement on exactly the
            // same path as ordinary pay — it posts and appears on a payslip.
            db.leaveBalance.findMany.mockResolvedValue([
                { total_days: 12, used_days: 4, leave_type: { name: 'Annual', allows_encashment: true } },
            ]);

            const result = await service.prepareFinalSettlement('t1', 'emp-1', { year: 2026, month: 9 });

            expect(result.created).toBe(1);
            const data = db.payrollAdjustment.create.mock.calls[0][0].data;
            expect(data.kind).toBe('EARNING');
            expect(data.amount).toBe(8000);
            expect(data.note).toContain('Annual');
        });

        it('creates nothing when there is no leave to encash', async () => {
            const result = await service.prepareFinalSettlement('t1', 'emp-1', { year: 2026, month: 9 });
            expect(result.created).toBe(0);
            expect(db.payrollAdjustment.create).not.toHaveBeenCalled();
        });
    });
});
