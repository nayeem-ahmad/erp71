import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MetricsTokenGuard } from './metrics-token.guard';

describe('MetricsTokenGuard', () => {
    const guard = new MetricsTokenGuard();

    const contextFor = (req: any) =>
        ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

    afterEach(() => {
        delete process.env.METRICS_TOKEN;
    });

    it('hides the endpoint (404) when METRICS_TOKEN is unset', () => {
        expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(NotFoundException);
    });

    it('rejects a missing or wrong token', () => {
        process.env.METRICS_TOKEN = 'secret';
        expect(() => guard.canActivate(contextFor({ headers: {}, query: {} }))).toThrow(UnauthorizedException);
        expect(() =>
            guard.canActivate(contextFor({ headers: { authorization: 'Bearer nope' }, query: {} })),
        ).toThrow(UnauthorizedException);
    });

    it('accepts a valid bearer token', () => {
        process.env.METRICS_TOKEN = 'secret';
        expect(
            guard.canActivate(contextFor({ headers: { authorization: 'Bearer secret' }, query: {} })),
        ).toBe(true);
    });

    it('accepts the token via query param', () => {
        process.env.METRICS_TOKEN = 'secret';
        expect(guard.canActivate(contextFor({ headers: {}, query: { token: 'secret' } }))).toBe(true);
    });
});
