import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseTokenService } from './firebase-token.service';
import { GoogleTokenService } from './google-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TotpService } from './totp.service';
import { accountThrottler } from '../common/account-throttle.util';
import { ApiThrottlerGuard } from '../common/api-throttler.guard';
import { defaultThrottler, ipThrottler } from '../common/default-throttle.util';
import { applyProxyTrust } from '../common/trust-proxy.util';

/**
 * The real `AuthController`'s budgets, behind production's throttlers exactly as
 * `app.module.ts` builds them with no `THROTTLE_*` set, which is how production
 * runs: per signed-in user (per address without a token), the per-address
 * ceiling, and the account dimension.
 */
describe('AuthController rate limits', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [ThrottlerModule.forRoot([defaultThrottler({}), accountThrottler, ipThrottler({})])],
            controllers: [AuthController],
            providers: [
                { provide: APP_GUARD, useClass: ApiThrottlerGuard },
                { provide: AuthService, useValue: { getMe: jest.fn().mockResolvedValue({ id: 'user-1' }) } },
                { provide: TotpService, useValue: {} },
                { provide: GoogleTokenService, useValue: {} },
                { provide: FirebaseTokenService, useValue: {} },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({
                canActivate: (context: any) => {
                    context.switchToHttp().getRequest().user = { userId: 'user-1' };
                    return true;
                },
            })
            .compile();
        app = moduleRef.createNestApplication<NestExpressApplication>();
        applyProxyTrust(app as unknown as NestExpressApplication);
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    const getMe = (ip: string) =>
        request(app.getHttpServer()).get('/auth/me').set('x-forwarded-for', ip);

    // Reported as "Too many sign-in attempts" with the right password in hand.
    // The app shell, most pages and several hooks each ask `/auth/me` on mount,
    // so one shop's floor spent the 20-a-minute default between them; the shell
    // then sent everyone to /login, where the sign-in itself succeeded and the
    // `/auth/me` that follows it was refused on the same exhausted budget.
    it('lets a shop floor behind one address load its pages', async () => {
        const office = '203.0.113.40';
        for (let i = 0; i < 100; i++) {
            await getMe(office).expect(200);
        }
    });

    it('still caps one host asking it without end', async () => {
        const caller = '203.0.113.41';
        let refusedAt: number | null = null;
        for (let i = 1; i <= 1000 && refusedAt === null; i++) {
            const res = await getMe(caller);
            if (res.status === 429) refusedAt = i;
        }
        expect(refusedAt).not.toBeNull();
    });

    // Signed the way `AuthModule` signs, so the throttler keys these on the user.
    const issuer = new JwtService({ secret: process.env.JWT_SECRET || 'fallback-secret-for-dev-only' });
    const tokenFor = (userId: string) => issuer.sign({ sub: userId, tv: 0, scope: 'app' }, { expiresIn: 3600 });
    const getMeAs = (ip: string, userId: string) => getMe(ip).set('Authorization', `Bearer ${tokenFor(userId)}`);

    it('keeps its 300 a minute for a signed-in user, not the 120 platform default', async () => {
        const caller = '203.0.113.42';
        for (let i = 0; i < 300; i++) {
            await getMeAs(caller, 'user-1').expect(200);
        }
        const refused = await getMeAs(caller, 'user-1');
        expect(refused.status).toBe(429);
        expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    });

    it('keeps its 300 a minute per address however many people are signed in there', async () => {
        // The route's own budget holds per address as before, so the per-user key
        // does not turn one host into many budgets.
        const office = '203.0.113.43';
        const people = ['user-a', 'user-b', 'user-c'];
        for (let round = 0; round < 100; round++) {
            for (const person of people) {
                await getMeAs(office, person).expect(200);
            }
        }
        await getMeAs(office, 'user-d').expect(429);
    });
});
