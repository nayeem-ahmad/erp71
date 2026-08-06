import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmployeePortalService } from './employee-portal.service';
import { AttendanceService } from '../attendance/attendance.service';
import { AttendanceCaptureService } from '../attendance/attendance-capture.service';
import { ExpenseClaimsService } from '../expense-claims/expense-claims.service';
import { EmployeeRecordsService } from '../employee-records/employee-records.service';
import { DatabaseService } from '../database/database.service';

describe('EmployeePortalService', () => {
    let service: EmployeePortalService;
    let db: any;
    let attendance: any;
    let capture: any;
    let claims: any;
    let records: any;

    beforeEach(async () => {
        db = {
            attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
            leaveBalance: { findMany: jest.fn().mockResolvedValue([]) },
            leaveRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
            salaryPayment: { findMany: jest.fn().mockResolvedValue([]) },
            payrollLine: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            employee: { findFirst: jest.fn(), update: jest.fn() },
        };
        attendance = {
            getEmployeeAttendanceSummary: jest.fn().mockResolvedValue({ summary: {}, total: 0 }),
            createLeaveRequest: jest.fn().mockResolvedValue({ id: 'req-1' }),
            cancelLeaveRequest: jest.fn().mockResolvedValue({ id: 'req-1', status: 'CANCELLED' }),
        };
        capture = {
            today: jest.fn().mockResolvedValue({}),
            checkIn: jest.fn().mockResolvedValue({}),
            checkOut: jest.fn().mockResolvedValue({}),
        };
        claims = {
            list: jest.fn().mockResolvedValue([]),
            get: jest.fn().mockResolvedValue({}),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            submit: jest.fn().mockResolvedValue({}),
            cancel: jest.fn().mockResolvedValue({}),
            addAttachment: jest.fn().mockResolvedValue({}),
            removeAttachment: jest.fn().mockResolvedValue({}),
        };
        records = {
            listAssignments: jest.fn().mockResolvedValue([]),
            acknowledgeAssignment: jest.fn().mockResolvedValue({}),
            policiesForEmployee: jest.fn().mockResolvedValue([]),
            acknowledgePolicy: jest.fn().mockResolvedValue({}),
            listDocuments: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmployeePortalService,
                { provide: DatabaseService, useValue: db },
                { provide: AttendanceService, useValue: attendance },
                { provide: AttendanceCaptureService, useValue: capture },
                { provide: ExpenseClaimsService, useValue: claims },
                { provide: EmployeeRecordsService, useValue: records },
            ],
        }).compile();

        service = module.get(EmployeePortalService);
    });

    describe('every read is scoped to the one employee', () => {
        it('scopes attendance to the employee and the requested month', async () => {
            await service.listAttendance('t1', 'emp-1', 2026, 3);

            const where = db.attendanceRecord.findMany.mock.calls[0][0].where;
            expect(where.tenant_id).toBe('t1');
            expect(where.employee_id).toBe('emp-1');
            expect(where.date.gte).toEqual(new Date(2026, 2, 1));
            expect(where.date.lte).toEqual(new Date(2026, 3, 0));
        });

        it('defaults to the current month when no period is given', async () => {
            const now = new Date();
            const result = await service.listAttendance('t1', 'emp-1');
            expect(result.period).toEqual({ year: now.getFullYear(), month: now.getMonth() + 1 });
        });

        it('scopes salary payments to the employee and caps the list', async () => {
            await service.listSalaryPayments('t1', 'emp-1');
            const args = db.salaryPayment.findMany.mock.calls[0][0];
            expect(args.where).toEqual({ tenant_id: 't1', employee_id: 'emp-1' });
            expect(args.take).toBe(6);
        });

        it('scopes leave requests to the employee and excludes deleted', async () => {
            await service.listLeaveRequests('t1', 'emp-1');
            expect(db.leaveRequest.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 't1', employee_id: 'emp-1', deleted_at: null,
            });
        });
    });

    describe('leave balances', () => {
        it('derives remaining days rather than trusting a stored figure', async () => {
            db.leaveBalance.findMany.mockResolvedValue([
                { leave_type_id: 'lt-1', year: 2026, total_days: 10, used_days: 3, leave_type: { id: 'lt-1', name: 'Annual' } },
            ]);

            const [balance] = await service.listLeaveBalances('t1', 'emp-1', 2026);
            expect(balance.remaining_days).toBe(7);
            expect(balance.leave_type).toBe('Annual');
        });
    });

    describe('leave actions delegate to AttendanceService', () => {
        it('applies with the employee id from the caller, not the DTO', async () => {
            await service.applyForLeave('t1', 'emp-1', {
                leave_type_id: 'lt-1',
                start_date: '2026-09-01',
                end_date: '2026-09-02',
                days: 2,
            } as any);

            expect(attendance.createLeaveRequest).toHaveBeenCalledWith('t1', expect.objectContaining({
                employee_id: 'emp-1',
                leave_type_id: 'lt-1',
            }));
        });

        it('passes the employee scope when cancelling', async () => {
            // Without the third argument any employee could cancel any request
            // by id — the scope is the whole authorisation check here.
            await service.cancelLeaveRequest('t1', 'emp-1', 'req-9');
            expect(attendance.cancelLeaveRequest).toHaveBeenCalledWith('t1', 'req-9', 'emp-1');
        });
    });

    describe('setPortalAccess', () => {
        it('grants access to an employee with a linked login', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'emp-1', user_id: 'user-1' });
            db.employee.update.mockResolvedValue({ id: 'emp-1', portal_access: true });

            await service.setPortalAccess('t1', 'emp-1', true);

            expect(db.employee.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'emp-1' },
                data: { portal_access: true },
            }));
        });

        it('refuses to grant access to an employee with no linked login', async () => {
            // The grant would be unusable — nobody can sign in as them.
            db.employee.findFirst.mockResolvedValue({ id: 'emp-1', user_id: null });

            await expect(service.setPortalAccess('t1', 'emp-1', true))
                .rejects.toThrow(BadRequestException);
            expect(db.employee.update).not.toHaveBeenCalled();
        });

        it('allows revoking access from an employee with no linked login', async () => {
            // Revocation must always work, including for a record left in a
            // half-state by an unlink.
            db.employee.findFirst.mockResolvedValue({ id: 'emp-1', user_id: null });
            db.employee.update.mockResolvedValue({ id: 'emp-1', portal_access: false });

            await service.setPortalAccess('t1', 'emp-1', false);
            expect(db.employee.update).toHaveBeenCalled();
        });

        it('refuses an employee outside the tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await expect(service.setPortalAccess('t1', 'emp-other', true))
                .rejects.toThrow(NotFoundException);
        });
    });

    describe('getSummary', () => {
        it('assembles the month in one pass', async () => {
            db.leaveRequest.count.mockResolvedValue(2);
            const summary = await service.getSummary('t1', 'emp-1', 2026, 5);

            expect(summary.period).toEqual({ year: 2026, month: 5 });
            expect(summary.pendingLeaveRequests).toBe(2);
            expect(attendance.getEmployeeAttendanceSummary)
                .toHaveBeenCalledWith('t1', 'emp-1', 2026, 5);
        });

        it('counts only pending requests as pending', async () => {
            await service.getSummary('t1', 'emp-1');
            expect(db.leaveRequest.count.mock.calls[0][0].where.status).toBe('PENDING');
        });
    });
    describe('payslips', () => {
        it('shows only payslips from approved or paid runs', async () => {
            // A draft is a working figure HR is still editing; showing it would
            // have people asking why their pay changed between two visits.
            await service.listPayslips('t1', 'emp-1');
            expect(db.payrollLine.findMany.mock.calls[0][0].where.run.status)
                .toEqual({ in: ['APPROVED', 'PAID'] });
        });

        it('scopes the list to the one employee', async () => {
            await service.listPayslips('t1', 'emp-1');
            expect(db.payrollLine.findMany.mock.calls[0][0].where).toMatchObject({
                tenant_id: 't1', employee_id: 'emp-1',
            });
        });

        it('refuses a payslip from a draft run', async () => {
            db.payrollLine.findFirst.mockResolvedValue(null);
            await expect(service.getPayslip('t1', 'emp-1', 'run-1'))
                .rejects.toThrow(NotFoundException);
        });

        it('scopes a single payslip to the token employee', async () => {
            db.payrollLine.findFirst.mockResolvedValue({ id: 'line-1' });
            await service.getPayslip('t1', 'emp-1', 'run-1');
            expect(db.payrollLine.findFirst.mock.calls[0][0].where).toMatchObject({
                tenant_id: 't1', employee_id: 'emp-1', run_id: 'run-1',
            });
        });
    });
    describe('expense claims', () => {
        it('scopes the claim list to the token employee', async () => {
            await service.listClaims('t1', 'emp-1');
            expect(claims.list).toHaveBeenCalledWith('t1', { employeeId: 'emp-1' });
        });

        it('passes the employee scope when reading one claim', async () => {
            // The scope is the authorisation check — a claim belonging to
            // somebody else must 404, not 403.
            await service.getClaim('t1', 'emp-1', 'claim-9');
            expect(claims.get).toHaveBeenCalledWith('t1', 'claim-9', 'emp-1');
        });

        it('creates a claim for the token employee, not a supplied id', async () => {
            await service.createClaim('t1', 'emp-1', { title: 'X' });
            expect(claims.create).toHaveBeenCalledWith('t1', 'emp-1', { title: 'X' });
        });

        it('passes the scope on every mutation', async () => {
            await service.updateClaim('t1', 'emp-1', 'c1', {});
            await service.submitClaim('t1', 'emp-1', 'c1');
            await service.cancelClaim('t1', 'emp-1', 'c1');
            await service.removeClaimAttachment('t1', 'emp-1', 'att-1');

            expect(claims.update).toHaveBeenCalledWith('t1', 'c1', 'emp-1', {});
            expect(claims.submit).toHaveBeenCalledWith('t1', 'c1', 'emp-1');
            expect(claims.cancel).toHaveBeenCalledWith('t1', 'c1', 'emp-1');
            expect(claims.removeAttachment).toHaveBeenCalledWith('t1', 'att-1', 'emp-1');
        });
    });
    describe('assets, policies and documents', () => {
        it('shows only assets the employee still holds', async () => {
            // A returned laptop is not something to acknowledge.
            await service.listMyAssets('t1', 'emp-1');
            expect(records.listAssignments).toHaveBeenCalledWith('t1', {
                employeeId: 'emp-1', outstandingOnly: true,
            });
        });

        it('acknowledges an asset as the token employee', async () => {
            await service.acknowledgeAsset('t1', 'emp-1', 'a-1');
            expect(records.acknowledgeAssignment).toHaveBeenCalledWith('t1', 'emp-1', 'a-1');
        });

        it('acknowledges a policy as the token employee', async () => {
            await service.acknowledgePolicy('t1', 'emp-1', 'pol-1');
            expect(records.acknowledgePolicy).toHaveBeenCalledWith('t1', 'emp-1', 'pol-1');
        });

        it('scopes documents to the token employee', async () => {
            await service.listMyDocuments('t1', 'emp-1');
            expect(records.listDocuments).toHaveBeenCalledWith('t1', 'emp-1');
        });
    });
});
