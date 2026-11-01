import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NAV_REGISTRY } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { TransformInterceptor } from '../common/transform.interceptor';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { Meet71AdminController } from './meet71-admin.controller';
import { Meet71InviteService } from './meet71-invite.service';
import { Meet71MembershipService } from './meet71-membership.service';

const ADMIN = {
    userId: 'admin-1',
    email: 'nayeem.ahmad@gmail.com',
    isPlatformAdmin: true,
    platformRole: null,
};

const SUPPORT = {
    userId: 'se-1',
    email: 'help@erp71.com',
    isPlatformAdmin: false,
    platformRole: 'SUPPORT_ENGINEER',
};

function fakeDb() {
    return {
        meet71DenyEntry: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
            deleteMany: jest.fn(),
        },
        meet71AllowEntry: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            upsert: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn(),
        },
        meet71Member: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            upsert: jest.fn(),
            deleteMany: jest.fn(),
        },
        meet71Room: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        $transaction: jest.fn(),
    };
}

describe('Meet71AdminController', () => {
    let app: INestApplication;
    let db: ReturnType<typeof fakeDb>;
    const audit = { log: jest.fn() };

    async function buildApp(user: typeof ADMIN | typeof SUPPORT) {
        db = fakeDb();
        db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
        db.meet71AllowEntry.findMany.mockResolvedValue([]);
        db.meet71Member.findMany.mockResolvedValue([]);
        db.meet71DenyEntry.findMany.mockResolvedValue([]);
        audit.log.mockResolvedValue(undefined);

        const module = await Test.createTestingModule({
            controllers: [Meet71AdminController],
            providers: [
                PlatformAdminGuard,
                Meet71MembershipService,
                { provide: Meet71InviteService, useValue: { invite: jest.fn() } },
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: audit },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({
                canActivate: (context: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
                    const req = context.switchToHttp().getRequest();
                    req.user = user;
                    return true;
                },
            })
            .compile();

        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new HttpExceptionFilter());
        app.useGlobalInterceptors(new TransformInterceptor());
        await app.init();
    }

    afterEach(async () => {
        await app?.close();
    });

    it('platform admin GET /admin/meet71 is 200', async () => {
        await buildApp(ADMIN);

        const res = await request(app.getHttpServer()).get('/admin/meet71').expect(200);

        expect(res.body.data).toEqual({ entries: [], members: [], denials: [] });
    });

    it('support engineer GET /admin/meet71 is 403', async () => {
        await buildApp(SUPPORT);

        await request(app.getHttpServer()).get('/admin/meet71').expect(403);
        expect(db.meet71Member.findMany).not.toHaveBeenCalled();
    });

    it('DELETE member covered only by @domain inserts Meet71DenyEntry', async () => {
        await buildApp(ADMIN);
        db.meet71Member.deleteMany.mockResolvedValue({ count: 1 });
        db.meet71AllowEntry.deleteMany.mockResolvedValue({ count: 0 });
        db.meet71AllowEntry.findMany.mockResolvedValue([{ pattern: '@erp71.com', kind: 'DOMAIN' }]);
        db.meet71DenyEntry.upsert.mockResolvedValue({
            id: 'deny-1',
            email: 'blocked@erp71.com',
            created_by: ADMIN.email,
        });

        await request(app.getHttpServer())
            .delete(`/admin/meet71/members/${encodeURIComponent('Blocked@ERP71.com')}`)
            .expect(204);

        expect(db.meet71Member.deleteMany).toHaveBeenCalledWith({ where: { email: 'blocked@erp71.com' } });
        expect(db.meet71AllowEntry.deleteMany).toHaveBeenCalledWith({ where: { pattern: 'blocked@erp71.com' } });
        expect(db.meet71DenyEntry.upsert).toHaveBeenCalledWith({
            where: { email: 'blocked@erp71.com' },
            create: { email: 'blocked@erp71.com', created_by: ADMIN.email },
            update: {},
        });
        expect(audit.log).toHaveBeenCalledWith(
            expect.any(String),
            'Meet71DenyEntry',
            expect.objectContaining({ tenantId: undefined, userId: ADMIN.userId }),
            expect.anything(),
            expect.objectContaining({ email: 'blocked@erp71.com' }),
        );
    });

    it('POST allowlist of a denied email is 403 MEET71_DENIED', async () => {
        await buildApp(ADMIN);
        db.meet71DenyEntry.findUnique.mockResolvedValue({ email: 'blocked@erp71.com' });

        const res = await request(app.getHttpServer())
            .post('/admin/meet71/allowlist')
            .send({ pattern: 'Blocked@ERP71.com' })
            .expect(403);

        expect(res.body.error).toMatchObject({ code: 'MEET71_DENIED' });
        expect(db.meet71AllowEntry.upsert).not.toHaveBeenCalled();
    });

    it('NAV_REGISTRY has admin.meet71', () => {
        expect(NAV_REGISTRY['admin.meet71']).toMatchObject({
            id: 'admin.meet71',
            kind: 'link',
            icon: 'Video',
            labelKey: 'sidebar.items.meet71',
            href: '/admin/meet71',
        });
    });
});
