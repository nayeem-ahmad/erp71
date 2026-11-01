import { createHash, timingSafeEqual } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { Meet71ServiceGuard } from './meet71-service.guard';

function ctx(headers: Record<string, string | undefined>) {
    return {
        switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as any;
}

describe('Meet71ServiceGuard', () => {
    const previousSecret = process.env.MEET71_ERP71_SECRET;
    const previousPrevious = process.env.MEET71_ERP71_SECRET_PREVIOUS;
    let guard: Meet71ServiceGuard;

    beforeEach(() => {
        process.env.MEET71_ERP71_SECRET = 'current-secret';
        delete process.env.MEET71_ERP71_SECRET_PREVIOUS;
        guard = new Meet71ServiceGuard();
    });

    afterEach(() => {
        if (previousSecret === undefined) delete process.env.MEET71_ERP71_SECRET;
        else process.env.MEET71_ERP71_SECRET = previousSecret;
        if (previousPrevious === undefined) delete process.env.MEET71_ERP71_SECRET_PREVIOUS;
        else process.env.MEET71_ERP71_SECRET_PREVIOUS = previousPrevious;
    });

    it('missing service key is 401', () => {
        expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(ctx({ 'x-meet71-service-key': undefined }))).toThrow(
            UnauthorizedException,
        );
    });

    it('wrong service key is 401', () => {
        expect(() => guard.canActivate(ctx({ 'x-meet71-service-key': 'nope' }))).toThrow(
            UnauthorizedException,
        );
    });

    it('accepts the current secret', () => {
        expect(guard.canActivate(ctx({ 'x-meet71-service-key': 'current-secret' }))).toBe(true);
    });

    it('accepts MEET71_ERP71_SECRET_PREVIOUS during rotate', () => {
        process.env.MEET71_ERP71_SECRET_PREVIOUS = 'previous-secret';
        expect(guard.canActivate(ctx({ 'x-meet71-service-key': 'previous-secret' }))).toBe(true);
    });

    it('a shorter key is 401, not a throw from timingSafeEqual', () => {
        process.env.MEET71_ERP71_SECRET = 'a-much-longer-secret-value';
        expect(() => guard.canActivate(ctx({ 'x-meet71-service-key': 'x' }))).toThrow(UnauthorizedException);
    });

    it('hashes both sides so timingSafeEqual never sees a length mismatch', () => {
        const provided = 'short';
        const expected = 'a-much-longer-secret-value';
        const left = createHash('sha256').update(provided).digest();
        const right = createHash('sha256').update(expected).digest();
        expect(left.length).toBe(right.length);
        expect(timingSafeEqual(left, right)).toBe(false);
    });

    it('an unset current secret does not accept an empty header', () => {
        delete process.env.MEET71_ERP71_SECRET;
        expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(ctx({ 'x-meet71-service-key': '' }))).toThrow(UnauthorizedException);
    });
});
