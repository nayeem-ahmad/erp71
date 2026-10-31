import { ForbiddenException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingSuspensionGuard } from '../auth/billing-suspension.guard';
import { ALLOW_WHEN_SUSPENDED_KEY } from '../auth/billing-suspension.decorator';
import { TransformInterceptor } from '../common/transform.interceptor';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { Meet71Controller } from './meet71.controller';
import { Meet71MembershipService } from './meet71-membership.service';
import { Meet71SsoService } from './meet71-sso.service';
import { DatabaseService } from '../database/database.service';

const RETURN_URL = 'https://meet.erp71.com/api/auth/erp71/callback';
const ORIGINS = 'https://meet.erp71.com,http://localhost:3071,http://127.0.0.1:3071,http://localhost:3000';

const MINT_BODY = {
    return_url: RETURN_URL,
    code_challenge: 'abc',
    code_challenge_method: 'S256',
    state: 'opaque-state',
};

const MEMBERSHIP = {
    allowed: true as const,
    email: 'member@erp71.com',
    displayName: 'Member',
    isAdmin: false,
    canCreateRoom: false,
    inviteQuota: 0,
    invitesUsed: 0,
    invitesRemaining: 0,
};

describe('Meet71Controller', () => {
    let app: INestApplication;
    const membership = { evaluate: jest.fn(), upsertOnSignIn: jest.fn() };
    const sso = { mint: jest.fn(), exchange: jest.fn() };
    const db = { user: { findUnique: jest.fn() } };

    const previousOrigins = process.env.MEET71_RETURN_ORIGINS;

    beforeEach(async () => {
        jest.resetAllMocks();
        process.env.MEET71_RETURN_ORIGINS = ORIGINS;
        membership.evaluate.mockResolvedValue(MEMBERSHIP);
        sso.mint.mockResolvedValue({ code: 'minted-code' });
        db.user.findUnique.mockResolvedValue({ name: 'Member', email: 'member@erp71.com' });

        const module = await Test.createTestingModule({
            controllers: [Meet71Controller],
            providers: [
                { provide: Meet71MembershipService, useValue: membership },
                { provide: Meet71SsoService, useValue: sso },
                { provide: DatabaseService, useValue: db },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({
                canActivate: (context: any) => {
                    const req = context.switchToHttp().getRequest();
                    req.user = {
                        userId: 'user-1',
                        email: 'member@erp71.com',
                        scope: 'app',
                        mustChangePassword: false,
                    };
                    return true;
                },
            })
            .compile();

        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new HttpExceptionFilter());
        app.useGlobalInterceptors(new TransformInterceptor());
        await app.init();
    });

    afterEach(async () => {
        await app?.close();
        if (previousOrigins === undefined) delete process.env.MEET71_RETURN_ORIGINS;
        else process.env.MEET71_RETURN_ORIGINS = previousOrigins;
    });

    it('storefront-scoped JWT on POST /meet71/sso/code is 401', () => {
        const guard = new JwtAuthGuard();
        const user = { userId: 'user-1', scope: 'storefront' };
        const ctx = {
            switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/v1/meet71/sso/code' }) }),
        };
        expect(() => guard.handleRequest(null, user, null, ctx)).toThrow(UnauthorizedException);
        expect(() => guard.handleRequest(null, user, null, ctx)).toThrow(
            'This session is not valid for the application API',
        );
    });

    it('app JWT not on allowlist is 403 MEET71_NOT_ALLOWED', async () => {
        membership.evaluate.mockResolvedValue({ allowed: false });

        const res = await request(app.getHttpServer()).post('/meet71/sso/code').send(MINT_BODY).expect(403);

        expect(res.body.error).toMatchObject({
            code: 'MEET71_NOT_ALLOWED',
            message: 'This account is not on the Meet71 list.',
        });
        expect(sso.mint).not.toHaveBeenCalled();
    });

    it('app JWT on allowlist returns data.code', async () => {
        const res = await request(app.getHttpServer()).post('/meet71/sso/code').send(MINT_BODY).expect(200);

        expect(res.body.data.code).toBe('minted-code');
        expect(sso.mint).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                email: 'member@erp71.com',
                returnUrl: RETURN_URL,
                codeChallenge: 'abc',
                codeChallengeMethod: 'S256',
            }),
        );
    });

    it('return_url https://evil.com is rejected', async () => {
        await request(app.getHttpServer())
            .post('/meet71/sso/code')
            .send({ ...MINT_BODY, return_url: 'https://evil.com/api/auth/erp71/callback' })
            .expect(400);
        expect(sso.mint).not.toHaveBeenCalled();
    });

    it('return_url https://meet.erp71.com.evil.com is rejected', async () => {
        await request(app.getHttpServer())
            .post('/meet71/sso/code')
            .send({ ...MINT_BODY, return_url: 'https://meet.erp71.com.evil.com/api/auth/erp71/callback' })
            .expect(400);
        expect(sso.mint).not.toHaveBeenCalled();
    });

    it('suspended tenant can still mint (@AllowWhenSuspended / meet71 prefix)', async () => {
        expect(Reflect.getMetadata(ALLOW_WHEN_SUSPENDED_KEY, Meet71Controller.prototype.mint)).toBe(true);

        const suspendedDb = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    billing_suspended_at: new Date('2026-09-01T00:00:00Z'),
                    billing_suspension_reason: 'Unpaid.',
                }),
            },
            tenantUser: { findMany: jest.fn() },
        };
        const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
        const guard = new BillingSuspensionGuard(suspendedDb as never, reflector as never);
        const ctx = {
            getType: () => 'http',
            switchToHttp: () => ({
                getRequest: () => ({
                    method: 'POST',
                    path: '/api/v1/meet71/sso/code',
                    headers: { 'x-tenant-id': 'tenant-1' },
                    user: { userId: 'user-1' },
                }),
            }),
            getHandler: () => undefined,
            getClass: () => undefined,
        } as any;

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('mustChangePassword user can mint (path meet71/sso/code on allowlist)', () => {
        const guard = new JwtAuthGuard();
        const pending = { userId: 'user-1', scope: 'app', mustChangePassword: true };
        const ctx = {
            switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/v1/meet71/sso/code' }) }),
        };
        expect(guard.handleRequest(null, pending, null, ctx)).toBe(pending);
        expect(() =>
            guard.handleRequest(null, pending, null, {
                switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/v1/sales' }) }),
            }),
        ).toThrow(ForbiddenException);
    });
});
