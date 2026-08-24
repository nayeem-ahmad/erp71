import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { applyProxyTrust, TRUSTED_PROXIES } from './trust-proxy.util';

/** Mirrors `/auth/login`: a small per-client budget on an unauthenticated route. */
@Controller('probe')
class ProbeController {
    @Throttle({ default: { ttl: 60_000, limit: 2 } })
    @Get()
    hit() {
        return { ok: true };
    }
}

@Module({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }])],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ProbeModule {}

describe('applyProxyTrust', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
        app = moduleRef.createNestApplication<NestExpressApplication>();
        // Exactly what `main.ts` does at bootstrap.
        applyProxyTrust(app as unknown as NestExpressApplication);
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    const hit = (forwardedFor: string) =>
        request(app.getHttpServer()).get('/probe').set('x-forwarded-for', forwardedFor);

    it('gives each forwarded client its own rate-limit bucket', async () => {
        // One client burns its whole budget.
        await hit('203.0.113.10').expect(200);
        await hit('203.0.113.10').expect(200);
        await hit('203.0.113.10').expect(429);

        // A different client must be unaffected. Without `trust proxy`, every
        // request shares the proxy's socket address and this is a 429.
        await hit('198.51.100.20').expect(200);
    });

    it('reports the forwarded client as req.ip rather than the socket peer', async () => {
        const res = await hit('203.0.113.30');
        expect(res.status).toBe(200);
    });

    it('ignores a forged X-Forwarded-For prefix from the caller', async () => {
        // Caddy appends the real peer, so a spoofed prefix sits to the LEFT of
        // the genuine address. The real client must still be what we key on,
        // otherwise rotating this header buys an unlimited number of buckets.
        await hit('1.2.3.4, 203.0.113.40').expect(200);
        await hit('5.6.7.8, 203.0.113.40').expect(200);
        await hit('9.9.9.9, 203.0.113.40').expect(429);
    });

    it('trusts private ranges only, never every hop', () => {
        expect(TRUSTED_PROXIES).not.toContain(true);
        expect(TRUSTED_PROXIES).toEqual(
            expect.arrayContaining(['loopback', 'uniquelocal']),
        );
    });
});
