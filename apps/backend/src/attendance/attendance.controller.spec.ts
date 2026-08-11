import { INestApplication, CallHandler, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceCaptureService } from './attendance-capture.service';
import { AttendancePunchService } from './attendance-punch.service';
import { OvertimeService } from './overtime.service';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';

describe('AttendanceController — subscription guard', () => {
    let app: INestApplication;

    const attendanceService = {
        listLeaveTypes: jest.fn().mockResolvedValue([]),
        createLeaveType: jest.fn().mockResolvedValue({}),
        updateLeaveType: jest.fn().mockResolvedValue({}),
        deleteLeaveType: jest.fn().mockResolvedValue({}),
        setLeaveBalance: jest.fn().mockResolvedValue({}),
        getLeaveBalance: jest.fn().mockResolvedValue({}),
        createLeaveRequest: jest.fn().mockResolvedValue({}),
        listLeaveRequests: jest.fn().mockResolvedValue([]),
        reviewLeaveRequest: jest.fn().mockResolvedValue({}),
        cancelLeaveRequest: jest.fn().mockResolvedValue({}),
        upsertAttendance: jest.fn().mockResolvedValue({}),
        getAttendanceSummary: jest.fn().mockResolvedValue({}),
        deleteAttendance: jest.fn().mockResolvedValue({}),
    } as any;

    const captureService = {
        getSettings: jest.fn().mockResolvedValue({}),
        updateSettings: jest.fn().mockResolvedValue({}),
    } as any;

    const punchService = {
        list: jest.fn().mockResolvedValue({ items: [] }),
        listDay: jest.fn().mockResolvedValue({ punches: [] }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        remove: jest.fn().mockResolvedValue({}),
    } as any;

    const overtimeService = {
        list: jest.fn().mockResolvedValue([]),
        generateForMonth: jest.fn().mockResolvedValue({}),
        review: jest.fn().mockResolvedValue({}),
        listSnapshots: jest.fn().mockResolvedValue([]),
        buildSnapshots: jest.fn().mockResolvedValue({}),
        freezeMonth: jest.fn().mockResolvedValue({}),
        unfreezeMonth: jest.fn().mockResolvedValue({}),
    } as any;

    const db = {
        tenantUser: { findUnique: jest.fn() },
        tenantSubscription: { findUnique: jest.fn() },
        tenantAddonSubscription: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    class MockJwtAuthGuard {
        canActivate(context: any) {
            context.switchToHttp().getRequest().user = { userId: 'user-1', email: 'u@example.com' };
            return true;
        }
    }

    class MockTenantInterceptor {
        intercept(ctx: ExecutionContext, next: CallHandler) {
            // The real interceptor resolves this from the membership row. The
            // `@Tenant()` decorator rejects a request without it, so a handler
            // is never reached unless it is set.
            ctx.switchToHttp().getRequest().tenantId = 'tenant-1';
            return next.handle();
        }
    }

    const buildApp = async () => {
        const module = await Test.createTestingModule({
            controllers: [AttendanceController],
            providers: [
                { provide: AttendanceService, useValue: attendanceService },
                { provide: AttendanceCaptureService, useValue: captureService },
                { provide: AttendancePunchService, useValue: punchService },
                { provide: OvertimeService, useValue: overtimeService },
                { provide: DatabaseService, useValue: db },
                Reflector,
                SubscriptionAccessGuard,
            ],
        })
            .overrideGuard(JwtAuthGuard).useClass(MockJwtAuthGuard)
            .overrideInterceptor(TenantInterceptor).useClass(MockTenantInterceptor)
            .compile();

        app = module.createNestApplication();
        await app.init();
        return app;
    };

    afterEach(() => app?.close());

    it('allows access for STANDARD plan', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'STANDARD', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/attendance/leave-types')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).not.toBe(403);
    });

    it('blocks BASIC plan subscribers with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'BASIC', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/attendance/leave-types')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('blocks FREE plan subscribers with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'FREE', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/attendance/leave-types')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('blocks PAST_DUE subscriptions with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'PAST_DUE',
            plan: { code: 'STANDARD', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/attendance/leave-types')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('routes a punch delete to the punch service, not the day-record one', async () => {
        // `DELETE /attendance/:id` is declared on the same controller, so if the
        // punch routes ever move below it Nest reads `punches` as a record id
        // and silently deletes the wrong thing.
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'STANDARD', features_json: {} },
        });
        await buildApp();

        await request(app.getHttpServer())
            .delete('/attendance/punches/p-1')
            .set('x-tenant-id', 'tenant-1');

        expect(punchService.remove).toHaveBeenCalledWith('tenant-1', 'p-1');
        expect(attendanceService.deleteAttendance).not.toHaveBeenCalled();
    });

    it('blocks a user who is not a member of the requested tenant with 401', async () => {
        db.tenantUser.findUnique.mockResolvedValue(null);
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'STANDARD', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/attendance/leave-types')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(401);
    });
});
