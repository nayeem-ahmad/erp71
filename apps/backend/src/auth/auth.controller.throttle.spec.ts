import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { applyProxyTrust } from '../common/trust-proxy.util';

/**
 * The real `AuthController`'s budgets, behind production's default: 20 a minute
 * per address, which is what `app.module.ts` falls back to and what production
 * runs on because `THROTTLE_LIMIT` is not set there.
 */
describe('AuthController rate limits', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }, accountThrottler])],
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
});
