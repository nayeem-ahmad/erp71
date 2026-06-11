import { ExecutionContext } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { AuthGuard } from '@nestjs/passport';

const makeContext = (headers: Record<string, string> = {}): ExecutionContext =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({ headers }),
        }),
        getType: () => 'http',
    } as any);

describe('ApiKeyGuard', () => {
    it('is defined and instantiable', () => {
        const guard = new ApiKeyGuard();
        expect(guard).toBeDefined();
    });

    it('extends AuthGuard with the "api-key" strategy', () => {
        const ApiKeyBase = AuthGuard('api-key');
        const guard = new ApiKeyGuard();
        expect(guard).toBeInstanceOf(ApiKeyBase);
    });

    it('is injectable (has Injectable metadata)', () => {
        const metadata = Reflect.getMetadata('__injectable__', ApiKeyGuard);
        expect(metadata).toBe(true);
    });

    // ─── handleRequest ────────────────────────────────────────────────────────

    describe('handleRequest', () => {
        let guard: ApiKeyGuard;

        beforeEach(() => {
            guard = new ApiKeyGuard();
        });

        it('returns the user when authentication succeeds', () => {
            const user = { tenantId: 'tenant-1', apiKeyId: 'key-1' };
            const result = guard.handleRequest(null, user);
            expect(result).toBe(user);
        });

        it('returns false (not throws) when user is null', () => {
            const result = guard.handleRequest(null, null);
            expect(result).toBe(false as any);
        });

        it('returns false (not throws) when user is undefined', () => {
            const result = guard.handleRequest(null, undefined);
            expect(result).toBe(false as any);
        });

        it('returns false (not throws) when err is provided and user is absent', () => {
            const result = guard.handleRequest(new Error('invalid key'), null);
            expect(result).toBe(false as any);
        });

        it('returns false (not throws) when err is truthy but user exists', () => {
            // err takes precedence — guard returns false so CombinedAuthGuard can fall through
            const user = { tenantId: 'tenant-1', apiKeyId: 'key-1' };
            const result = guard.handleRequest(new Error('some error'), user);
            expect(result).toBe(false as any);
        });

        it('does NOT throw UnauthorizedException — allows CombinedAuthGuard fall-through', () => {
            expect(() => guard.handleRequest(new Error('fail'), null)).not.toThrow();
        });
    });

    // ─── canActivate ──────────────────────────────────────────────────────────

    describe('canActivate', () => {
        let guard: ApiKeyGuard;

        beforeEach(() => {
            guard = new ApiKeyGuard();
        });

        it('delegates to parent canActivate', () => {
            const ctx = makeContext({ 'x-api-key': 'my-key' });

            const parentCanActivate = jest.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(guard)),
                'canActivate',
            ).mockReturnValue(true as any);

            guard.canActivate(ctx);

            expect(parentCanActivate).toHaveBeenCalledWith(ctx);
            parentCanActivate.mockRestore();
        });

        it('passes through the result from the parent (truthy)', async () => {
            const ctx = makeContext({ 'x-api-key': 'valid-key' });

            const parentCanActivate = jest.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(guard)),
                'canActivate',
            ).mockResolvedValue(true as any);

            const result = await guard.canActivate(ctx);

            expect(result).toBe(true);
            parentCanActivate.mockRestore();
        });

        it('passes through the result from the parent (falsy)', async () => {
            const ctx = makeContext({});

            const parentCanActivate = jest.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(guard)),
                'canActivate',
            ).mockResolvedValue(false as any);

            const result = await guard.canActivate(ctx);

            expect(result).toBe(false);
            parentCanActivate.mockRestore();
        });
    });
});
