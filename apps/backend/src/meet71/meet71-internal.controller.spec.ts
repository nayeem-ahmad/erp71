import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TransformInterceptor } from '../common/transform.interceptor';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { DatabaseService } from '../database/database.service';
import { Meet71InternalController } from './meet71-internal.controller';
import { Meet71InviteService } from './meet71-invite.service';
import { Meet71MembershipService } from './meet71-membership.service';
import { Meet71SsoService } from './meet71-sso.service';
import { Meet71ServiceGuard } from './meet71-service.guard';

const SECRET = 'test-meet71-secret';

function siteBlock(caddyfile: string, host: string): string {
    const start = caddyfile.indexOf(`${host} {`);
    if (start < 0) throw new Error(`missing site block for ${host}`);
    let depth = 0;
    for (let i = start; i < caddyfile.length; i++) {
        if (caddyfile[i] === '{') depth++;
        else if (caddyfile[i] === '}') {
            depth--;
            if (depth === 0) return caddyfile.slice(start, i + 1);
        }
    }
    throw new Error(`unclosed site block for ${host}`);
}

describe('Meet71InternalController', () => {
    let app: INestApplication;
    const membership = {
        evaluate: jest.fn(),
        upsertOnSignIn: jest.fn(),
        listAdmin: jest.fn(),
        addAllowlist: jest.fn(),
        removeAllowlist: jest.fn(),
        patchMember: jest.fn(),
        deleteMember: jest.fn(),
        removeDenial: jest.fn(),
        patchRoom: jest.fn(),
    };
    const sso = { mint: jest.fn(), exchange: jest.fn() };
    const invites = { invite: jest.fn() };
    const db = {
        meet71Member: { create: jest.fn(), findUnique: jest.fn() },
        meet71Room: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };

    const previousSecret = process.env.MEET71_ERP71_SECRET;

    beforeEach(async () => {
        jest.resetAllMocks();
        process.env.MEET71_ERP71_SECRET = SECRET;
        membership.evaluate.mockResolvedValue({ allowed: false });

        const module = await Test.createTestingModule({
            controllers: [Meet71InternalController],
            providers: [
                Meet71ServiceGuard,
                { provide: Meet71MembershipService, useValue: membership },
                { provide: Meet71SsoService, useValue: sso },
                { provide: Meet71InviteService, useValue: invites },
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new HttpExceptionFilter());
        app.useGlobalInterceptors(new TransformInterceptor());
        await app.init();
    });

    afterEach(async () => {
        await app?.close();
        if (previousSecret === undefined) delete process.env.MEET71_ERP71_SECRET;
        else process.env.MEET71_ERP71_SECRET = previousSecret;
    });

    it('missing service key is 401', async () => {
        await request(app.getHttpServer()).get('/internal/meet71/membership').query({ email: 'a@b.com' }).expect(401);
        expect(membership.evaluate).not.toHaveBeenCalled();
    });

    it('wrong service key is 401', async () => {
        await request(app.getHttpServer())
            .get('/internal/meet71/membership')
            .query({ email: 'a@b.com' })
            .set('X-Meet71-Service-Key', 'nope')
            .expect(401);
        expect(membership.evaluate).not.toHaveBeenCalled();
    });

    it('GET membership does not create a Meet71Member', async () => {
        membership.evaluate.mockResolvedValue({ allowed: false });

        const res = await request(app.getHttpServer())
            .get('/internal/meet71/membership')
            .query({ email: 'new@erp71.com' })
            .set('X-Meet71-Service-Key', SECRET)
            .expect(200);

        expect(res.body.data).toEqual({ allowed: false });
        expect(membership.evaluate).toHaveBeenCalledWith('new@erp71.com');
        expect(membership.upsertOnSignIn).not.toHaveBeenCalled();
        expect(db.meet71Member.create).not.toHaveBeenCalled();
    });

    it('PUT allowlist of a denied email is 403 MEET71_DENIED', async () => {
        membership.addAllowlist.mockRejectedValue(
            new ForbiddenException({ code: 'MEET71_DENIED', message: 'This email is blocked on Meet71.' }),
        );

        const res = await request(app.getHttpServer())
            .put('/internal/meet71/allowlist')
            .set('X-Meet71-Service-Key', SECRET)
            .send({ pattern: 'blocked@erp71.com' })
            .expect(403);

        expect(res.body.error).toMatchObject({ code: 'MEET71_DENIED' });
    });

    it('in-repo Caddyfile 404s path /api/v1/internal/* on api.erp71.com and app.erp71.com', () => {
        const caddyfile = fs.readFileSync(path.join(__dirname, '../../../../Caddyfile'), 'utf8');
        for (const host of ['app.erp71.com', 'api.erp71.com']) {
            const block = siteBlock(caddyfile, host);
            const marker = block.indexOf('@meet71internal path /api/v1/internal/*');
            const deny = block.indexOf('respond 404');
            const proxy = block.indexOf('reverse_proxy');
            expect(marker).toBeGreaterThanOrEqual(0);
            expect(deny).toBeGreaterThan(marker);
            expect(proxy).toBeGreaterThan(deny);
        }
    });

    it('in-repo Caddyfile reverse-proxies meet.erp71.com /rtc* to LiveKit and the rest to the app', () => {
        const caddyfile = fs.readFileSync(path.join(__dirname, '../../../../Caddyfile'), 'utf8');
        const block = siteBlock(caddyfile, 'meet.erp71.com');
        const rtc = block.indexOf('handle /rtc*');
        const livekit = block.indexOf('reverse_proxy meet71-livekit-1:7880');
        const app = block.indexOf('reverse_proxy meet71-app-1:3000');
        expect(rtc).toBeGreaterThanOrEqual(0);
        expect(livekit).toBeGreaterThan(rtc);
        expect(app).toBeGreaterThan(livekit);
    });

    it('in-repo Caddyfile imports Caddyfile.neighbors', () => {
        const caddyfile = fs.readFileSync(path.join(__dirname, '../../../../Caddyfile'), 'utf8');
        expect(caddyfile).toMatch(/^import Caddyfile\.neighbors\s*$/m);
    });
});
