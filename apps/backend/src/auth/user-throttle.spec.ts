import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle, ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { accountThrottler } from '../common/account-throttle.util';
import { ApiThrottlerGuard } from '../common/api-throttler.guard';
import {
    DEFAULT_THROTTLE_LIMIT,
    defaultThrottler,
    IP_THROTTLE_LIMIT,
    ipThrottler,
} from '../common/default-throttle.util';
import { applyProxyTrust } from '../common/trust-proxy.util';

@Controller('probe')
class ProbeController {
    /** An ordinary route on the platform default, like `GET /products`. */
    @Get('default')
    plain() {
        return { ok: true };
    }

    /** A route with its own per-caller budget, like `POST /auth/login`. */
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    @Get('own-budget')
    ownBudget() {
        return { ok: true };
    }

    /** The escape hatch for a route that wants a different budget per address. */
    @Throttle({ default: { ttl: 60_000, limit: 5 }, ip: { ttl: 60_000, limit: 8 } })
    @Get('own-address-budget')
    ownAddressBudget() {
        return { ok: true };
    }

    /** Like `/metrics`. */
    @SkipThrottle()
    @Get('skipped')
    skipped() {
        return { ok: true };
    }
}

@Module({
    // Production's throttlers with production's numbers. The env is passed
    // empty so a THROTTLE_* variable in the test environment cannot change them.
    imports: [ThrottlerModule.forRoot([defaultThrottler({}), accountThrottler, ipThrottler({})])],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
})
class ProbeModule {}

/** Signs exactly the way `AuthModule` does: same secret and fallback, HS256. */
const issuer = new JwtService({ secret: process.env.JWT_SECRET || 'fallback-secret-for-dev-only' });
const accessToken = (userId: string, options: { expiresIn?: number } = {}) =>
    issuer.sign(
        { sub: userId, email: `${userId}@shop.example`, tv: 0, scope: 'app' },
        { expiresIn: options.expiresIn ?? 3600 },
    );

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('the default rate limit, keyed on the signed-in user', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
        app = moduleRef.createNestApplication<NestExpressApplication>();
        applyProxyTrust(app as unknown as NestExpressApplication, {});
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    const OFFICE = '203.0.113.60';

    const call = (path: string, ip: string, token?: string) => {
        const req = request(app.getHttpServer()).get(`/probe/${path}`).set('x-forwarded-for', ip);
        return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    /** Calls until the first 429, up to `max`; returns which call it was, or null. */
    async function firstRefusal(max: number, send: (i: number) => request.Test): Promise<number | null> {
        for (let i = 1; i <= max; i++) {
            const res = await send(i);
            if (res.status === 429) return i;
            expect(res.status).toBe(200);
        }
        return null;
    }

    it('lets three tills behind one office line make 100 calls a minute each', async () => {
        const tills = ['till-1', 'till-2', 'till-3'].map((id) => accessToken(id));
        for (let round = 0; round < 100; round++) {
            for (const token of tills) {
                await call('default', OFFICE, token).expect(200);
            }
        }
    });

    it('caps one user at the per-user budget, and only that user', async () => {
        const busy = accessToken('busy-user');

        const refusedAt = await firstRefusal(DEFAULT_THROTTLE_LIMIT + 1, () => call('default', OFFICE, busy));
        expect(refusedAt).toBe(DEFAULT_THROTTLE_LIMIT + 1);

        const refused = await call('default', OFFICE, busy);
        expect(refused.status).toBe(429);
        expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(refused.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });

        // A colleague on the same line still has their own budget.
        await call('default', OFFICE, accessToken('colleague')).expect(200);
    });

    it('reports the per-user budget and the address ceiling in the headers', async () => {
        const res = await call('default', OFFICE, accessToken('header-user')).expect(200);
        expect(res.headers['x-ratelimit-limit']).toBe(String(DEFAULT_THROTTLE_LIMIT));
        expect(res.headers['x-ratelimit-limit-ip']).toBe(String(IP_THROTTLE_LIMIT));
        expect(DEFAULT_THROTTLE_LIMIT).toBe(120);
        expect(IP_THROTTLE_LIMIT).toBe(600);
    });

    it('puts forged and garbage tokens in their address bucket, not a fresh one each', async () => {
        const attacker = '198.51.100.66';
        const attackerSigner = new JwtService({ secret: 'not-our-secret' });
        const forged = (i: number): string => {
            switch (i % 5) {
                case 0:
                    return `not-a-jwt-${i}`;
                case 1:
                    // Right shape, wrong key.
                    return attackerSigner.sign({ sub: `victim-${i}` });
                case 2:
                    // Unsigned: `alg: none` must never be accepted.
                    return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: `none-${i}` })}.`;
                case 3:
                    // Genuine signature, payload swapped afterwards.
                    return accessToken('real-user').replace(/\.[^.]+\./, `.${base64url({ sub: `swap-${i}` })}.`);
                default:
                    // Ours, but expired.
                    return accessToken(`expired-${i}`, { expiresIn: -60 });
            }
        };

        const refusedAt = await firstRefusal(DEFAULT_THROTTLE_LIMIT + 1, (i) => call('default', attacker, forged(i)));
        expect(refusedAt).toBe(DEFAULT_THROTTLE_LIMIT + 1);

        // Same bucket as sending no token at all from that address.
        await call('default', attacker).expect(429);
    });

    it('caps an unauthenticated flood on its address without locking out signed-in users there', async () => {
        const refusedAt = await firstRefusal(DEFAULT_THROTTLE_LIMIT + 1, () => call('default', OFFICE));
        expect(refusedAt).toBe(DEFAULT_THROTTLE_LIMIT + 1);

        // The flood counted against the address ceiling too…
        const res = await call('default', OFFICE, accessToken('cashier')).expect(200);
        expect(Number(res.headers['x-ratelimit-remaining-ip'])).toBeLessThan(IP_THROTTLE_LIMIT - DEFAULT_THROTTLE_LIMIT);
        // …but a signed-in user on the same line is on their own budget.
    });

    it('caps one address at the ceiling however many accounts it signs in with', async () => {
        const accounts = Array.from({ length: IP_THROTTLE_LIMIT / 100 + 1 }, (_, i) => accessToken(`account-${i}`));

        let sent = 0;
        let refusal: request.Response | null = null;
        for (const token of accounts) {
            for (let i = 0; i < 100 && !refusal; i++) {
                const res = await call('default', OFFICE, token);
                sent++;
                if (res.status === 429) refusal = res;
                else expect(res.status).toBe(200);
            }
        }

        expect(refusal).not.toBeNull();
        expect(sent).toBe(IP_THROTTLE_LIMIT + 1);
        expect(Number(refusal!.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(refusal!.headers['retry-after-ip']).toBeDefined();

        // Another address is unaffected.
        await call('default', '198.51.100.70', accounts[0]).expect(200);
    });

    describe('a route with its own budget', () => {
        it('keeps that budget per address, even for callers with tokens', async () => {
            // Five a minute per address, as the decorator says — not five per
            // account, which a host holding many tokens could multiply.
            await call('own-budget', OFFICE, accessToken('a')).expect(200);
            await call('own-budget', OFFICE, accessToken('b')).expect(200);
            await call('own-budget', OFFICE, accessToken('c')).expect(200);
            await call('own-budget', OFFICE, accessToken('a')).expect(200);
            await call('own-budget', OFFICE, accessToken('b')).expect(200);
            await call('own-budget', OFFICE, accessToken('c')).expect(429);
        });

        it('also applies it per user, across addresses', async () => {
            const roaming = accessToken('roaming');
            for (let i = 0; i < 5; i++) {
                await call('own-budget', `198.51.100.${80 + i}`, roaming).expect(200);
            }
            await call('own-budget', '198.51.100.90', roaming).expect(429);
        });

        it('can still set a different budget for the address explicitly', async () => {
            const users = ['x', 'y', 'z'].map((id) => accessToken(id));
            let sent = 0;
            let refusedAt: number | null = null;
            for (let round = 0; round < 5 && refusedAt === null; round++) {
                for (const token of users) {
                    sent++;
                    const res = await call('own-address-budget', OFFICE, token);
                    if (res.status === 429) {
                        refusedAt = sent;
                        break;
                    }
                }
            }
            expect(refusedAt).toBe(9);
        });
    });

    it('leaves a @SkipThrottle() route unthrottled in both dimensions', async () => {
        const res = await call('skipped', OFFICE, accessToken('scraper')).expect(200);
        expect(res.headers['x-ratelimit-limit']).toBeUndefined();
        expect(res.headers['x-ratelimit-limit-ip']).toBeUndefined();
    });
});

describe('defaultThrottler / ipThrottler configuration', () => {
    it('keeps THROTTLE_LIMIT and THROTTLE_TTL_MS working', () => {
        expect(defaultThrottler({ THROTTLE_LIMIT: '50', THROTTLE_TTL_MS: '30000' })).toMatchObject({
            limit: 50,
            ttl: 30_000,
        });
    });

    it('ignores a value that is not a positive number instead of switching throttling off', () => {
        expect(defaultThrottler({ THROTTLE_LIMIT: 'lots' })).toMatchObject({ limit: DEFAULT_THROTTLE_LIMIT });
        expect(defaultThrottler({ THROTTLE_LIMIT: '0' })).toMatchObject({ limit: DEFAULT_THROTTLE_LIMIT });
    });

    async function ipLimit(env: NodeJS.ProcessEnv): Promise<number> {
        const { limit } = ipThrottler(env);
        const route = () => undefined;
        const context = { getHandler: () => route, getClass: () => class {} } as any;
        return typeof limit === 'function' ? limit(context) : limit;
    }

    it('takes THROTTLE_IP_LIMIT for the ceiling', async () => {
        expect(await ipLimit({})).toBe(IP_THROTTLE_LIMIT);
        expect(await ipLimit({ THROTTLE_IP_LIMIT: '900' })).toBe(900);
    });

    it('never puts the ceiling under a raised per-user budget unless told to', async () => {
        // The e2e stacks raise THROTTLE_LIMIT to stop throttling; the ceiling
        // must not quietly reintroduce it.
        expect(await ipLimit({ THROTTLE_LIMIT: '100000' })).toBe(100_000);
        expect(await ipLimit({ THROTTLE_LIMIT: '100000', THROTTLE_IP_LIMIT: '700' })).toBe(700);
    });
});
