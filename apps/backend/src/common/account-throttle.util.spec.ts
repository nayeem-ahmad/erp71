import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ThrottleAccount, accountFromBody, accountThrottler } from './account-throttle.util';
import { ApiThrottlerGuard } from './api-throttler.guard';
import { HttpExceptionFilter } from './http-exception.filter';
import { applyProxyTrust } from './trust-proxy.util';

/**
 * Three shapes of route, so each assertion has one plausible cause:
 * `login` can only trip on the account budget, `spray` only on the per-caller
 * one, and `open` carries no account budget at all.
 */
@Controller('probe')
class ProbeController {
    @Throttle({ default: { ttl: 60_000, limit: 100 } })
    @ThrottleAccount({ ttl: 60_000, limit: 2 })
    @Post('login')
    login(@Body() body: unknown) {
        return { ok: true, body };
    }

    @Throttle({ default: { ttl: 60_000, limit: 2 } })
    @ThrottleAccount({ ttl: 60_000, limit: 100 })
    @Post('spray')
    spray() {
        return { ok: true };
    }

    @Throttle({ default: { ttl: 60_000, limit: 2 } })
    @Post('open')
    open() {
        return { ok: true };
    }
}

@Module({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }, accountThrottler])],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
})
class ProbeModule {}

describe('account-keyed sign-in throttling', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
        app = moduleRef.createNestApplication<NestExpressApplication>();
        // Exactly what `main.ts` does at bootstrap.
        applyProxyTrust(app as unknown as NestExpressApplication);
        app.useGlobalFilters(new HttpExceptionFilter());
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    const post = (route: string, ip: string, body: Record<string, unknown>) =>
        request(app.getHttpServer()).post(`/probe/${route}`).set('x-forwarded-for', ip).send(body);

    // The reported bug: a shop's floor, or a mobile carrier's NAT pool, all
    // arrive on one address, and one person's attempts used to spend everyone's
    // budget.
    it('gives each account its own budget behind a shared address', async () => {
        const office = '203.0.113.10';

        await post('login', office, { identifier: 'karim@shop.test', password: 'x' }).expect(201);
        await post('login', office, { identifier: 'karim@shop.test', password: 'x' }).expect(201);
        await post('login', office, { identifier: 'karim@shop.test', password: 'x' }).expect(429);

        // A colleague on the same address is unaffected — before the split, this
        // was the 429 that locked a shop out of its own till.
        await post('login', office, { identifier: 'rina@shop.test', password: 'x' }).expect(201);
        await post('login', office, { identifier: '01712345678', password: 'x' }).expect(201);
    });

    it('holds one account to its budget however many addresses it is tried from', async () => {
        await post('login', '203.0.113.11', { identifier: 'karim@shop.test', password: 'x' }).expect(201);
        await post('login', '198.51.100.22', { identifier: 'karim@shop.test', password: 'x' }).expect(201);
        // The per-IP budget of the old design reset here. The account's does not.
        await post('login', '192.0.2.33', { identifier: 'karim@shop.test', password: 'x' }).expect(429);
    });

    it('counts spellings of one account as that account, not as several', async () => {
        await post('login', '203.0.113.12', { identifier: 'Karim@Shop.test', password: 'x' }).expect(201);
        await post('login', '203.0.113.12', { identifier: '  karim@shop.test  ', password: 'x' }).expect(201);
        await post('login', '203.0.113.12', { email: 'KARIM@SHOP.TEST', password: 'x' }).expect(429);
    });

    it('counts one mobile number as one account whichever way it is written', async () => {
        await post('login', '203.0.113.13', { identifier: '01712345678', password: 'x' }).expect(201);
        await post('login', '203.0.113.13', { identifier: '+8801712345678', password: 'x' }).expect(201);
        await post('login', '203.0.113.13', { identifier: '017-1234-5678', password: 'x' }).expect(429);
    });

    it('still caps one host working through a list of accounts', async () => {
        const attacker = '203.0.113.14';
        await post('spray', attacker, { identifier: 'a@shop.test', password: 'x' }).expect(201);
        await post('spray', attacker, { identifier: 'b@shop.test', password: 'x' }).expect(201);
        // A fresh account each time buys a fresh account bucket, and no more
        // room at all on the per-caller ceiling.
        await post('spray', attacker, { identifier: 'c@shop.test', password: 'x' }).expect(429);
    });

    it('leaves routes that did not opt in on the per-caller budget alone', async () => {
        const caller = '203.0.113.15';
        await post('open', caller, { identifier: 'a@shop.test' }).expect(201);
        await post('open', caller, { identifier: 'b@shop.test' }).expect(201);
        // A different identifier must not buy a third: this route never asked
        // for account keying.
        await post('open', caller, { identifier: 'c@shop.test' }).expect(429);
    });

    it('answers a throttled caller with something they can act on', async () => {
        const caller = '203.0.113.16';
        const attempt = () => post('login', caller, { identifier: 'karim@shop.test', password: 'x' });
        await attempt();
        await attempt();

        const res = await attempt().expect(429);

        // The default message is the library's own class name — see
        // ApiThrottlerGuard for why that reaching the sign-in screen is the bug.
        expect(res.body.error.message).not.toContain('ThrottlerException');
        expect(res.body.error).toEqual({
            code: 'TOO_MANY_REQUESTS',
            message: expect.stringMatching(/^Too many requests\. Please wait \d+ seconds? and try again\.$/),
            retry_after: expect.any(Number),
        });
        expect(res.body.error.retry_after).toBeGreaterThan(0);
        expect(res.headers['retry-after']).toBe(String(res.body.error.retry_after));
    });

    it('never puts the account it throttled into the response', async () => {
        const caller = '203.0.113.17';
        const attempt = () => post('login', caller, { identifier: 'karim@shop.test', password: 'x' });
        await attempt();
        await attempt();

        const res = await attempt().expect(429);
        expect(JSON.stringify(res.body)).not.toContain('karim@shop.test');
    });
});

describe('accountFromBody', () => {
    it('reads the identifier the login service reads, alias included', () => {
        expect(accountFromBody({ identifier: 'owner@shop.test' })).toBe('email:owner@shop.test');
        expect(accountFromBody({ email: 'owner@shop.test' })).toBe('email:owner@shop.test');
        // `identifier` wins, matching `dto.identifier ?? dto.email` in the service.
        expect(accountFromBody({ identifier: 'a@shop.test', email: 'b@shop.test' })).toBe('email:a@shop.test');
    });

    it('normalises addresses and numbers to one key per account', () => {
        expect(accountFromBody({ identifier: '  Owner@Shop.TEST ' })).toBe('email:owner@shop.test');
        expect(accountFromBody({ identifier: '01712345678' })).toBe('mobile:+8801712345678');
        expect(accountFromBody({ identifier: '+8801712345678' })).toBe('mobile:+8801712345678');
    });

    it('honours the country a bare number was typed in', () => {
        expect(accountFromBody({ identifier: '9876543210', mobile_country_code: 'IN' })).toBe('mobile:+919876543210');
    });

    it('keys the 2FA leg on the account it names outright', () => {
        expect(accountFromBody({ userId: 'usr_123', code: '000000' })).toBe('user:usr_123');
    });

    it('keeps a mistyped number on its own key rather than the shared one', () => {
        // It cannot sign anyone in, but its owner is a real person retyping —
        // pushing them back onto the per-caller bucket is the bug this fixes.
        expect(accountFromBody({ identifier: '0171' })).toBe('mobile:0171');
    });

    it('names no account for a body that cannot be a sign-in', () => {
        expect(accountFromBody(null)).toBeNull();
        expect(accountFromBody('identifier=owner@shop.test')).toBeNull();
        expect(accountFromBody({})).toBeNull();
        expect(accountFromBody({ identifier: '   ' })).toBeNull();
        // Guards run before validation, so the body is whatever was posted.
        expect(accountFromBody({ identifier: { $ne: null } })).toBeNull();
        expect(accountFromBody({ identifier: ['a@shop.test'] })).toBeNull();
        expect(accountFromBody({ identifier: 12345 })).toBeNull();
        expect(accountFromBody({ identifier: `${'a'.repeat(320)}@shop.test` })).toBeNull();
    });
});
