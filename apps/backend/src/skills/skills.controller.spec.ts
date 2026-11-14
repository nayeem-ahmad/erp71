import { INestApplication, CallHandler, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { StorePermission } from '@erp71/shared-types';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { AuthCacheService } from '../database/auth-cache.service';
import { DatabaseService } from '../database/database.service';

describe('SkillsController — permissions', () => {
    let app: INestApplication;

    const skillsService = {
        list: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        remove: jest.fn().mockResolvedValue({}),
        assignPerson: jest.fn().mockResolvedValue({}),
        updatePerson: jest.fn().mockResolvedValue({}),
        removePerson: jest.fn().mockResolvedValue({ success: true }),
    } as any;

    const membershipRows = (role: string | null, tenantId = 'tenant-1', userId = 'user-1') =>
        role === null
            ? []
            : [{
                tenant_id: tenantId,
                user_id: userId,
                role,
                tenant_deleted_at: null,
                tenant_timezone: null,
                roles: [],
            }];

    const db = {
        $queryRaw: jest.fn(),
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

    const grant = (permissions: StorePermission[], role = 'MANAGER') => {
        db.$queryRaw.mockResolvedValue(membershipRows(role));
        db.userStorePermission.findMany.mockResolvedValue(
            permissions.map((permission) => ({ store_id: 'store-1', permission })),
        );
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module = await Test.createTestingModule({
            controllers: [SkillsController],
            providers: [
                { provide: SkillsService, useValue: skillsService },
                { provide: DatabaseService, useValue: db },
                { provide: AuthCacheService, useValue: new AuthCacheService({ ttlMs: 0 }) },
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

    it('lets VIEW_HR list the catalogue', async () => {
        grant([StorePermission.VIEW_HR]);
        await request(app.getHttpServer()).get('/skills').expect(200);
        expect(skillsService.list).toHaveBeenCalled();
    });

    it('lets VIEW_PROJECTS list the catalogue so a project can pick skills', async () => {
        grant([StorePermission.VIEW_PROJECTS]);
        await request(app.getHttpServer()).get('/skills').expect(200);
    });

    it('refuses a catalogue write with only VIEW_PROJECTS', async () => {
        grant([StorePermission.VIEW_PROJECTS]);
        await request(app.getHttpServer()).post('/skills').send({ name: 'Welding' }).expect(403);
    });

    it('refuses the catalogue with no relevant permission', async () => {
        grant([]);
        await request(app.getHttpServer()).get('/skills').expect(403);
    });

    it.each([
        ['post', '/skills'],
        ['patch', '/skills/s1'],
        ['delete', '/skills/s1'],
        ['post', '/skills/people'],
        ['patch', '/skills/people/ps1'],
        ['delete', '/skills/people/ps1'],
    ])('refuses %s %s without MANAGE_HR', async (method, path) => {
        grant([StorePermission.VIEW_HR]);
        await (request(app.getHttpServer()) as any)[method](path).send({ name: 'Welding' }).expect(403);
    });

    it('allows creating a skill with MANAGE_HR', async () => {
        grant([StorePermission.VIEW_HR, StorePermission.MANAGE_HR]);
        await request(app.getHttpServer()).post('/skills').send({ name: 'Welding' }).expect(201);
        expect(skillsService.create).toHaveBeenCalled();
    });
});
