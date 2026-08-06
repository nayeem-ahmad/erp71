import { INestApplication, CallHandler, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { StorePermission } from '@erp71/shared-types';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';

/**
 * Pins Phase 0 of the HRIS plan: this controller guarded with `JwtAuthGuard`
 * alone until 2026-08-06, so any authenticated user in the tenant could read
 * every salary figure in it. These cases exist so that cannot come back.
 *
 * The real `StorePermissionGuard` runs here against a mocked grant table —
 * mocking the guard itself would assert nothing, since the guard *is* the
 * behaviour under test.
 */
describe('EmployeesController — permissions', () => {
    let app: INestApplication;

    const employeesService = {
        findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
        findOne: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        remove: jest.fn().mockResolvedValue(undefined),
        listDepartments: jest.fn().mockResolvedValue([]),
        createDepartment: jest.fn().mockResolvedValue({}),
        listDesignations: jest.fn().mockResolvedValue([]),
        createDesignation: jest.fn().mockResolvedValue({}),
        importRows: jest.fn().mockResolvedValue({}),
        linkUser: jest.fn().mockResolvedValue({}),
        unlinkUser: jest.fn().mockResolvedValue({}),
    } as any;

    const db = {
        tenantUser: { findUnique: jest.fn() },
        userStoreAccess: { findMany: jest.fn().mockResolvedValue([]) },
        userStorePermission: { findMany: jest.fn() },
    } as any;

    class MockJwtAuthGuard {
        canActivate(context: any) {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: 'user-1', email: 'u@example.com' };
            req.tenantId = 'tenant-1';
            req.storeId = 'store-1';
            return true;
        }
    }

    class MockTenantInterceptor {
        intercept(_ctx: ExecutionContext, next: CallHandler) { return next.handle(); }
    }

    /** Sign in as a member holding exactly `permissions`. */
    const grant = (permissions: StorePermission[], role = 'MANAGER') => {
        db.tenantUser.findUnique.mockResolvedValue({ role });
        db.userStorePermission.findMany.mockResolvedValue(
            permissions.map((permission) => ({ permission })),
        );
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module = await Test.createTestingModule({
            controllers: [EmployeesController],
            providers: [
                { provide: EmployeesService, useValue: employeesService },
                { provide: DatabaseService, useValue: db },
                Reflector,
                StorePermissionGuard,
            ],
        })
            .overrideGuard(JwtAuthGuard).useClass(MockJwtAuthGuard)
            .overrideInterceptor(TenantInterceptor).useClass(MockTenantInterceptor)
            .compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => { await app?.close(); });

    describe('reading the roster requires VIEW_HR', () => {
        it('allows a member holding VIEW_HR', async () => {
            grant([StorePermission.VIEW_HR]);
            await request(app.getHttpServer()).get('/employees').expect(200);
        });

        it('refuses an authenticated member holding no HR permission', async () => {
            grant([]);
            await request(app.getHttpServer()).get('/employees').expect(403);
        });

        it('refuses the employee detail endpoint too', async () => {
            grant([]);
            await request(app.getHttpServer()).get('/employees/emp-1').expect(403);
        });

        it('refuses departments and designations', async () => {
            grant([]);
            await request(app.getHttpServer()).get('/employees/departments').expect(403);
            await request(app.getHttpServer()).get('/employees/designations').expect(403);
        });
    });

    describe('changing the roster requires MANAGE_HR', () => {
        it('refuses a create from a member holding only VIEW_HR', async () => {
            grant([StorePermission.VIEW_HR]);
            await request(app.getHttpServer())
                .post('/employees')
                .send({ name: 'Alice', phone: '01700000000' })
                .expect(403);
            expect(employeesService.create).not.toHaveBeenCalled();
        });

        it('allows a create from a member holding MANAGE_HR', async () => {
            grant([StorePermission.VIEW_HR, StorePermission.MANAGE_HR]);
            await request(app.getHttpServer())
                .post('/employees')
                .send({ name: 'Alice', phone: '01700000000' })
                .expect(201);
            expect(employeesService.create).toHaveBeenCalled();
        });

        it.each([
            ['patch', '/employees/emp-1'],
            ['delete', '/employees/emp-1'],
            ['post', '/employees/departments'],
            ['post', '/employees/designations'],
            ['post', '/employees/import'],
            ['post', '/employees/emp-1/link-user'],
            ['delete', '/employees/emp-1/link-user'],
        ])('refuses %s %s without MANAGE_HR', async (method, path) => {
            grant([StorePermission.VIEW_HR]);
            await (request(app.getHttpServer()) as any)[method](path).send({}).expect(403);
        });
    });

    describe('OWNER bypass', () => {
        it('lets an owner through with no explicit grants', async () => {
            grant([], 'OWNER');
            await request(app.getHttpServer()).get('/employees').expect(200);
            await request(app.getHttpServer())
                .post('/employees')
                .send({ name: 'Alice', phone: '01700000000' })
                .expect(201);
        });
    });

    describe('viewer context reaches the service', () => {
        it('passes the tenant context to findAll so salary can be stripped', async () => {
            grant([StorePermission.VIEW_HR]);
            await request(app.getHttpServer()).get('/employees').expect(200);
            // Third argument is the viewer — without it the service strips
            // salary by default, so its absence is a visible bug, not a leak.
            expect(employeesService.findAll).toHaveBeenCalledWith(
                'tenant-1',
                expect.any(Object),
                expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
            );
        });

        it('passes the tenant context to findOne', async () => {
            grant([StorePermission.VIEW_HR]);
            await request(app.getHttpServer()).get('/employees/emp-1').expect(200);
            expect(employeesService.findOne).toHaveBeenCalledWith(
                'tenant-1',
                'emp-1',
                expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
            );
        });
    });
});
