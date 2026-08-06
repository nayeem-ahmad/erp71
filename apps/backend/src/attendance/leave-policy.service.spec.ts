import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceCaptureService } from './attendance-capture.service';
import { DatabaseService } from '../database/database.service';
import { LeaveRequestStatusDto } from './attendance.dto';

/**
 * HRIS Phase 11 — the policy engine as it behaves through `AttendanceService`.
 * The arithmetic itself is covered by `leave-policy.util.spec.ts`; this is the
 * wiring: balance checks on create, the approval chain, and carry-forward.
 */
describe('AttendanceService — leave policy', () => {
    let service: AttendanceService;
    let db: any;
    let capture: any;

    const TYPE = (over: Record<string, any> = {}) => ({
        id: 'lt-1', tenant_id: 't1', name: 'Annual', days_per_year: 12,
        accrual_mode: 'ANNUAL_GRANT', carry_forward_max_days: null,
        allows_half_day: true, requires_attachment: false, approval_levels: 1,
        deleted_at: null, ...over,
    });

    const REQUEST = (over: Record<string, any> = {}) => ({
        id: 'req-1', tenant_id: 't1', employee_id: 'emp-1', leave_type_id: 'lt-1',
        start_date: new Date(Date.UTC(2026, 7, 10)), end_date: new Date(Date.UTC(2026, 7, 12)),
        days: 3, status: 'PENDING', approvals_given: 0, ...over,
    });

    beforeEach(async () => {
        db = {
            employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
            leaveType: {
                findFirst: jest.fn().mockResolvedValue(TYPE()),
                findMany: jest.fn().mockResolvedValue([TYPE()]),
            },
            leaveBalance: {
                findFirst: jest.fn().mockResolvedValue({ total_days: 12, used_days: 0 }),
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            leaveRequest: {
                findFirst: jest.fn().mockResolvedValue(REQUEST()),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
            },
            leaveRequestApproval: { upsert: jest.fn().mockResolvedValue({}) },
        };
        capture = {
            markLeaveDays: jest.fn().mockResolvedValue(0),
            unmarkLeaveDays: jest.fn().mockResolvedValue(0),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AttendanceService,
                { provide: DatabaseService, useValue: db },
                { provide: AttendanceCaptureService, useValue: capture },
            ],
        }).compile();
        service = module.get(AttendanceService);
    });

    const createDto = (over: Record<string, any> = {}) => ({
        employee_id: 'emp-1', leave_type_id: 'lt-1',
        start_date: '2026-08-10', end_date: '2026-08-12', days: 3, ...over,
    });

    describe('policy checks on create', () => {
        it('accepts a request inside the balance', async () => {
            await service.createLeaveRequest('t1', createDto() as any);
            expect(db.leaveRequest.create).toHaveBeenCalled();
        });

        it('refuses more days than remain', async () => {
            // Read from the balance, never trusted from the client.
            db.leaveBalance.findFirst.mockResolvedValue({ total_days: 12, used_days: 11 });
            await expect(service.createLeaveRequest('t1', createDto({ days: 3 }) as any))
                .rejects.toThrow(/Only 1 day\(s\) remain/);
        });

        it('refuses any leave when no balance has been set', async () => {
            db.leaveBalance.findFirst.mockResolvedValue(null);
            await expect(service.createLeaveRequest('t1', createDto() as any))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses a half day on a type that forbids it', async () => {
            db.leaveType.findFirst.mockResolvedValue(TYPE({ allows_half_day: false }));
            await expect(service.createLeaveRequest('t1', createDto({ days: 0.5 }) as any))
                .rejects.toThrow(/half day/i);
        });

        it('allows a half day on a type that permits it', async () => {
            await service.createLeaveRequest('t1', createDto({ days: 0.5 }) as any);
            expect(db.leaveRequest.create).toHaveBeenCalled();
        });
    });

    describe('approval chain', () => {
        it('records the signature and completes at one level', async () => {
            await service.reviewLeaveRequest('t1', 'req-1', 'user-1', {
                status: LeaveRequestStatusDto.APPROVED,
            } as any);

            expect(db.leaveRequestApproval.upsert).toHaveBeenCalled();
            expect(db.leaveRequest.update.mock.calls.at(-1)[0].data.status).toBe('APPROVED');
        });

        it('stays pending after the first of two approvals', async () => {
            // The balance must not move and the attendance rows must not be
            // written until the chain is complete, or a half-approved request
            // would look taken.
            db.leaveType.findFirst.mockResolvedValue(TYPE({ approval_levels: 2 }));

            await service.reviewLeaveRequest('t1', 'req-1', 'user-1', {
                status: LeaveRequestStatusDto.APPROVED,
            } as any);

            const data = db.leaveRequest.update.mock.calls[0][0].data;
            expect(data.status).toBeUndefined();
            expect(data.approvals_given).toBe(1);
            expect(db.leaveBalance.upsert).not.toHaveBeenCalled();
            expect(capture.markLeaveDays).not.toHaveBeenCalled();
        });

        it('completes on the second approval of two', async () => {
            db.leaveType.findFirst.mockResolvedValue(TYPE({ approval_levels: 2 }));
            db.leaveRequest.findFirst.mockResolvedValue(REQUEST({ approvals_given: 1 }));

            await service.reviewLeaveRequest('t1', 'req-1', 'user-2', {
                status: LeaveRequestStatusDto.APPROVED,
            } as any);

            expect(db.leaveRequest.update.mock.calls.at(-1)[0].data.status).toBe('APPROVED');
            expect(capture.markLeaveDays).toHaveBeenCalled();
        });

        it('ends the chain immediately on a rejection', async () => {
            // There is nothing a second approver can add to "no".
            db.leaveType.findFirst.mockResolvedValue(TYPE({ approval_levels: 3 }));

            await service.reviewLeaveRequest('t1', 'req-1', 'user-1', {
                status: LeaveRequestStatusDto.REJECTED,
            } as any);

            expect(db.leaveRequest.update.mock.calls.at(-1)[0].data.status).toBe('REJECTED');
        });

        it('records the level on each signature', async () => {
            db.leaveType.findFirst.mockResolvedValue(TYPE({ approval_levels: 2 }));
            db.leaveRequest.findFirst.mockResolvedValue(REQUEST({ approvals_given: 1 }));

            await service.reviewLeaveRequest('t1', 'req-1', 'user-2', {
                status: LeaveRequestStatusDto.APPROVED,
            } as any);

            expect(db.leaveRequestApproval.upsert.mock.calls[0][0].create.level).toBe(2);
        });
    });

    describe('carry-forward', () => {
        it('carries the unused balance up to the cap', async () => {
            db.leaveType.findMany.mockResolvedValue([TYPE({ carry_forward_max_days: 5 })]);
            db.leaveBalance.findMany.mockResolvedValue([
                { employee_id: 'emp-1', leave_type_id: 'lt-1', total_days: 12, used_days: 4 },
            ]);

            const result = await service.runCarryForward('t1', 2026);

            expect(result.balances_carried).toBe(1);
            // 12 fresh + 5 carried (capped from 8 unused)
            expect(db.leaveBalance.upsert.mock.calls[0][0].create.total_days).toBe(17);
        });

        it('sets rather than increments, so a re-run is safe', async () => {
            db.leaveType.findMany.mockResolvedValue([TYPE({ carry_forward_max_days: 5 })]);
            db.leaveBalance.findMany.mockResolvedValue([
                { employee_id: 'emp-1', leave_type_id: 'lt-1', total_days: 12, used_days: 10 },
            ]);

            await service.runCarryForward('t1', 2026);

            expect(db.leaveBalance.upsert.mock.calls[0][0].update).toEqual({ total_days: 14 });
        });

        it('carries nothing when the type has no cap', async () => {
            db.leaveType.findMany.mockResolvedValue([TYPE()]);
            db.leaveBalance.findMany.mockResolvedValue([
                { employee_id: 'emp-1', leave_type_id: 'lt-1', total_days: 12, used_days: 0 },
            ]);

            const result = await service.runCarryForward('t1', 2026);

            expect(result.balances_carried).toBe(0);
            expect(db.leaveBalance.upsert).not.toHaveBeenCalled();
        });

        it('skips a balance whose leave type has been deleted', async () => {
            db.leaveType.findMany.mockResolvedValue([]);
            db.leaveBalance.findMany.mockResolvedValue([
                { employee_id: 'emp-1', leave_type_id: 'gone', total_days: 12, used_days: 0 },
            ]);

            const result = await service.runCarryForward('t1', 2026);
            expect(result.balances_carried).toBe(0);
        });
    });

    describe('leave calendar', () => {
        it('includes pending as well as approved', async () => {
            await service.getLeaveCalendar('t1', '2026-08-01', '2026-08-31');
            expect(db.leaveRequest.findMany.mock.calls[0][0].where.status)
                .toEqual({ in: ['APPROVED', 'PENDING'] });
        });

        it('finds requests that overlap the window, not only those inside it', async () => {
            await service.getLeaveCalendar('t1', '2026-08-01', '2026-08-31');
            const where = db.leaveRequest.findMany.mock.calls[0][0].where;
            expect(where.start_date.lte).toBeInstanceOf(Date);
            expect(where.end_date.gte).toBeInstanceOf(Date);
        });
    });
});
