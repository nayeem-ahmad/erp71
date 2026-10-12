import { Controller, Get, INestApplication, Module, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
    applyProxyTrust,
    CLOUDFLARE_PROXY_RANGES,
    TRUSTED_PROXIES,
    trustedProxies,
} from './trust-proxy.util';

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

/** Reports what Express resolved as the caller, which is what the throttler and audit log read. */
@Controller('whoami')
class WhoAmIController {
    @Get()
    whoAmI(@Req() req: { ip?: string }) {
        return { ip: req.ip };
    }
}

@Module({ controllers: [WhoAmIController] })
class WhoAmIModule {}

describe('applyProxyTrust behind Cloudflare', () => {
    let app: INestApplication;

    async function start(env: NodeJS.ProcessEnv) {
        const moduleRef = await Test.createTestingModule({ imports: [WhoAmIModule] }).compile();
        app = moduleRef.createNestApplication<NestExpressApplication>();
        applyProxyTrust(app as unknown as NestExpressApplication, env);
        await app.init();
    }

    afterEach(async () => {
        await app?.close();
    });

    // What reaches the backend with Cloudflare in front: Cloudflare appends the
    // visitor, Caddy (trusting Cloudflare's ranges) appends the edge it heard
    // from, and the socket peer is Caddy on loopback/the compose network.
    const whoAmI = async (forwardedFor: string) => {
        const res = await request(app.getHttpServer()).get('/whoami').set('x-forwarded-for', forwardedFor);
        expect(res.status).toBe(200);
        return res.body.ip as string;
    };

    describe('with TRUST_CLOUDFLARE_PROXY=true', () => {
        beforeEach(() => start({ TRUST_CLOUDFLARE_PROXY: 'true' }));

        it('steps over a Cloudflare IPv4 edge to the real visitor', async () => {
            expect(await whoAmI('198.51.100.7, 173.245.48.10')).toBe('198.51.100.7');
            expect(await whoAmI('198.51.100.8, 104.16.1.1')).toBe('198.51.100.8');
        });

        it('steps over a Cloudflare IPv6 edge to the real visitor', async () => {
            expect(await whoAmI('2001:db8::7, 2606:4700::6810:1')).toBe('2001:db8::7');
        });

        it('still ignores a forged prefix the visitor sent through Cloudflare', async () => {
            expect(await whoAmI('1.2.3.4, 198.51.100.9, 162.158.0.1')).toBe('198.51.100.9');
        });

        it('does not let a direct caller claim a Cloudflare hop it never made', async () => {
            // The right-most entry is the peer Caddy saw. Cloudflare-looking
            // values further left are never reached.
            expect(await whoAmI('198.51.100.10, 173.245.48.10, 203.0.113.50')).toBe('203.0.113.50');
        });
    });

    describe('without it (the default)', () => {
        beforeEach(() => start({}));

        it('treats the Cloudflare edge as the caller, never a header value', async () => {
            expect(await whoAmI('198.51.100.7, 173.245.48.10')).toBe('173.245.48.10');
            expect(await whoAmI('2001:db8::7, 2606:4700::6810:1')).toBe('2606:4700::6810:1');
        });

        it('treats anything but exactly "true" as off', () => {
            expect(trustedProxies({ TRUST_CLOUDFLARE_PROXY: '1' })).toEqual(TRUSTED_PROXIES);
            expect(trustedProxies({ TRUST_CLOUDFLARE_PROXY: 'false' })).toEqual(TRUSTED_PROXIES);
            expect(trustedProxies({})).toEqual(TRUSTED_PROXIES);
        });
    });

    it('lists both address families, as published', () => {
        expect(CLOUDFLARE_PROXY_RANGES.filter((r) => r.includes(':'))).toHaveLength(7);
        expect(CLOUDFLARE_PROXY_RANGES.filter((r) => !r.includes(':'))).toHaveLength(15);
        expect(trustedProxies({ TRUST_CLOUDFLARE_PROXY: 'true' })).toEqual(
            expect.arrayContaining([...TRUSTED_PROXIES, ...CLOUDFLARE_PROXY_RANGES]),
        );
    });
});
