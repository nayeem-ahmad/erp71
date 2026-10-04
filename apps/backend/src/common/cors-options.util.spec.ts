import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { buildCorsOptions, CORS_PREFLIGHT_MAX_AGE_SECONDS } from './cors-options.util';

@Controller('probe')
class ProbeController {
    @Get()
    hit() {
        return { ok: true };
    }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const ALLOWED = 'https://erp71.com';

describe('buildCorsOptions', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
        // The refused origin is logged as an unhandled error, as in production;
        // that is the existing behaviour, not what this suite is about.
        app = moduleRef.createNestApplication({ logger: false });
        // Exactly what `main.ts` does at bootstrap.
        app.enableCors(buildCorsOptions([ALLOWED]));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    // The shape of every authenticated call from another origin: the custom
    // headers are what make the browser ask first.
    const preflight = (origin: string) =>
        request(app.getHttpServer())
            .options('/probe')
            .set('Origin', origin)
            .set('Access-Control-Request-Method', 'GET')
            .set('Access-Control-Request-Headers', 'authorization,x-tenant-id,x-store-id');

    it('lets the browser reuse a preflight answer for two hours', async () => {
        const res = await preflight(ALLOWED);

        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
        expect(res.headers['access-control-max-age']).toBe(String(CORS_PREFLIGHT_MAX_AGE_SECONDS));
        expect(CORS_PREFLIGHT_MAX_AGE_SECONDS).toBe(7200);
    });

    it('still grants nothing to an origin that is not allowed', async () => {
        const res = await preflight('https://attacker.example');

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
        expect(res.headers['access-control-max-age']).toBeUndefined();
    });

    it('keeps credentials on for the allowed origin', async () => {
        const res = await request(app.getHttpServer()).get('/probe').set('Origin', ALLOWED);

        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
});
