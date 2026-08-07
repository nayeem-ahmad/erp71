import { CallHandler, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { StorePermission } from '@erp71/shared-types';
import { EmployeePortalController, EmployeePortalAdminController } from './employee-portal.controller';
import { EmployeePortalService } from './employee-portal.service';
import { EmployeeGuard } from './employee.guard';
import { EmployeesController } from '../employees/employees.controller';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';

/**
 * Phase 1 of the HRIS plan.
 *
 * The design note this file exists to enforce: unlike a referee or an investor,
 * an employee-portal user IS an ordinary tenant member with a real `TenantUser`
 * row. Their token is a normal ERP token; `active_context === 'employee'` is a
 * UI switch a client can lie about. What actually keeps them out of the staff
 * screens is that they hold no store permissions — so if a staff controller is
 * ever left unguarded, this portal hands every employee the keys to it.
 *
 * The last describe block is therefore the most important one here.
 */
describe('EmployeePortal — security', () => {
    let app: INestApplication;

    const EMPLOYEE = {
        id: 'emp-1',
        tenant_id: 'tenant-1',
        employee_code: 'EMP-00001',
        name: 'Alice',
        phone: '01700000000',
        email: 'alice@example.com',
        date_of_joining: null,
        status: 'ACTIVE',
        department: null,
        designation: null,
    };

    const portalService = {
        getSummary: jest.fn().mockResolvedValue({}),
        listAttendance: jest.fn().mockResolvedValue({ records: [] }),
        listLeaveBalances: jest.fn().mockResolvedValue([]),
        listLeaveRequests: jest.fn().mockResolvedValue([]),
        applyForLeave: jest.fn().mockResolvedValue({}),
        cancelLeaveRequest: jest.fn().mockResolvedValue({}),
        listSalaryPayments: jest.fn().mockResolvedValue([]),
        setPortalAccess: jest.fn().mockResolvedValue({}),
    } as any;

    const employeesService = {
        findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
        findOne: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        listDepartments: jest.fn().mockResolvedValue([]),
        listDesignations: jest.fn().mockResolvedValue([]),
    } as any;

    const db = {
        employee: { findFirst: jest.fn() },
        tenantUser: { findUnique: jest.fn().mockResolvedValue({ role: 'CASHIER' }) },
        userStoreAccess: { findMany: jest.fn().mockResolvedValue([]) },
        userStorePermission: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    class MockJwtAuthGuard {
        canActivate(context: any) {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: 'user-1', email: 'alice@example.com' };
            // A header a hostile client is free to set. Nothing below may trust it.
            req.tenantId = req.headers['x-tenant-id'] ?? 'tenant-1';
            req.storeId = 'store-1';
            return true;
        }
    }

    class MockTenantInterceptor {
        intercept(_ctx: ExecutionContext, next: CallHandler) { return next.handle(); }
    }

    beforeEach(async () => {
        jest.clearAllMocks();
        db.employee.findFirst.mockResolvedValue(EMPLOYEE);
        db.tenantUser.findUnique.mockResolvedValue({ role: 'CASHIER' });
        db.userStorePermission.findMany.mockResolvedValue([]);

        const module = await Test.createTestingModule({
            controllers: [EmployeePortalController, EmployeePortalAdminController, EmployeesController],
            providers: [
                { provide: EmployeePortalService, useValue: portalService },
                { provide: EmployeesService, useValue: employeesService },
                { provide: DatabaseService, useValue: db },
                Reflector,
                EmployeeGuard,
                StorePermissionGuard,
            ],
        })
            .overrideGuard(JwtAuthGuard).useClass(MockJwtAuthGuard)
            .overrideInterceptor(TenantInterceptor).useClass(MockTenantInterceptor)
            .compile();

        app = module.createNestApplication();
        // The same pipe `main.ts` installs globally. Without it this suite would
        // test a laxer app than the one that ships — and the smuggled-field case
        // below is precisely about what the pipe does.
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
    });

    afterEach(async () => { await app?.close(); });

    describe('EmployeeGuard admits only a live portal employee', () => {
        it('admits an active employee with portal access', async () => {
            await request(app.getHttpServer()).get('/employee-portal/me').expect(200);
        });

        it('refuses a user with no employee row', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await request(app.getHttpServer()).get('/employee-portal/me').expect(403);
        });

        it('queries on portal_access, ACTIVE and not-deleted — not on user_id alone', async () => {
            await request(app.getHttpServer()).get('/employee-portal/me').expect(200);
            expect(db.employee.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        user_id: 'user-1',
                        portal_access: true,
                        status: 'ACTIVE',
                        deleted_at: null,
                    }),
                }),
            );
        });

        it('does not leak the salary onto the profile payload', async () => {
            // An employee sees their own pay through /salary-payments, which is
            // deliberate. The *profile* is a different surface and the guard's
            // select must not quietly grow a basic_salary.
            const res = await request(app.getHttpServer()).get('/employee-portal/me').expect(200);
            expect(res.body.employee).not.toHaveProperty('basic_salary');
        });
    });

    describe('the employee is taken from the token, never from the request', () => {
        it('scopes the summary to the token employee and their own tenant', async () => {
            await request(app.getHttpServer())
                .get('/employee-portal/summary')
                .set('x-tenant-id', 'tenant-ATTACKER')
                .expect(200);

            expect(portalService.getSummary).toHaveBeenCalledWith(
                'tenant-1', 'emp-1', undefined, undefined,
            );
        });

        it('scopes a leave cancellation to the token employee', async () => {
            await request(app.getHttpServer())
                .patch('/employee-portal/leave-requests/req-999/cancel')
                .expect(200);

            // The employee id is the third argument and comes from the token —
            // `req-999` may belong to anyone; the service scopes on both.
            expect(portalService.cancelLeaveRequest).toHaveBeenCalledWith(
                'tenant-1', 'emp-1', 'req-999',
            );
        });

        it('rejects an employee_id smuggled into a leave application body', async () => {
            // `forbidNonWhitelisted` turns the attempt into a 400 rather than
            // silently dropping the field. Either would be safe — the service
            // builds its own payload — but failing loudly means the next person
            // to spread the DTO into a Prisma call cannot introduce the hole
            // without a test going red.
            await request(app.getHttpServer())
                .post('/employee-portal/leave-requests')
                .send({
                    employee_id: 'emp-SOMEONE-ELSE',
                    leave_type_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
                    start_date: '2026-09-01',
                    end_date: '2026-09-02',
                    days: 2,
                })
                .expect(400);

            expect(portalService.applyForLeave).not.toHaveBeenCalled();
        });

        it('applies leave for the token employee on a clean body', async () => {
            await request(app.getHttpServer())
                .post('/employee-portal/leave-requests')
                .send({
                    leave_type_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
                    start_date: '2026-09-01',
                    end_date: '2026-09-02',
                    days: 2,
                })
                .expect(201);

            const [tenantId, employeeId, dto] = portalService.applyForLeave.mock.calls[0];
            expect(tenantId).toBe('tenant-1');
            expect(employeeId).toBe('emp-1');
            expect(dto).not.toHaveProperty('employee_id');
        });
    });

    describe('granting portal access is a staff action', () => {
        it('refuses an employee-context token — they hold no MANAGE_HR', async () => {
            await request(app.getHttpServer())
                .post('/employees/emp-1/portal-access')
                .expect(403);
            expect(portalService.setPortalAccess).not.toHaveBeenCalled();
        });

        it('allows a staff member holding MANAGE_HR', async () => {
            db.userStorePermission.findMany.mockResolvedValue([
                { permission: StorePermission.MANAGE_HR },
            ]);
            await request(app.getHttpServer())
                .post('/employees/emp-1/portal-access')
                .expect(200);
            expect(portalService.setPortalAccess).toHaveBeenCalledWith('tenant-1', 'emp-1', true);
        });
    });

    /**
     * The invariant the whole portal design rests on. An employee token is a
     * normal tenant token — nothing structural stops it reaching a staff
     * controller, so every staff controller must refuse it on permissions.
     */
    describe('an employee token cannot reach the staff employee endpoints', () => {
        it.each([
            ['get', '/employees'],
            ['get', '/employees/emp-2'],
            ['get', '/employees/departments'],
            ['get', '/employees/designations'],
        ])('refuses %s %s', async (method, path) => {
            await (request(app.getHttpServer()) as any)[method](path).expect(403);
        });

        it('refuses a write to the staff employee endpoints', async () => {
            await request(app.getHttpServer())
                .post('/employees')
                .send({ name: 'Mallory', phone: '01900000000' })
                .expect(403);
            expect(employeesService.create).not.toHaveBeenCalled();
        });

        it('would pass if the staff controller were left unguarded — so it must not be', async () => {
            // Documents the failure mode rather than asserting a behaviour: with
            // a permission granted, the same token sails through. Nothing about
            // being "an employee" is what stops it; only the missing grant is.
            db.userStorePermission.findMany.mockResolvedValue([
                { permission: StorePermission.VIEW_HR },
            ]);
            await request(app.getHttpServer()).get('/employees').expect(200);
        });
    });
});
