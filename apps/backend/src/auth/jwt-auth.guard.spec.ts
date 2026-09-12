import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

describe('JwtAuthGuard', () => {
    it('is defined and instantiable', () => {
        const guard = new JwtAuthGuard();
        expect(guard).toBeDefined();
    });

    it('extends AuthGuard with the "jwt" strategy', () => {
        // AuthGuard('jwt') returns a class; JwtAuthGuard must be an instance of it
        const JwtBase = AuthGuard('jwt');
        const guard = new JwtAuthGuard();
        expect(guard).toBeInstanceOf(JwtBase);
    });

    it('is injectable (has Injectable metadata)', () => {
        // Reflect metadata is set by the @Injectable() decorator
        const metadata = Reflect.getMetadata('__injectable__', JwtAuthGuard);
        // NestJS sets this to true for injectable providers
        expect(metadata).toBe(true);
    });

    describe('canActivate', () => {
        it('delegates to passport JWT strategy', () => {
            const guard = new JwtAuthGuard();
            const mockContext = {
                switchToHttp: () => ({
                    getRequest: () => ({
                        headers: { authorization: 'Bearer valid.jwt.token' },
                    }),
                }),
                getType: () => 'http',
            } as any;

            // The parent canActivate calls passport — spy on it to verify delegation
            const parentCanActivate = jest.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(guard)),
                'canActivate',
            ).mockReturnValue(true as any);

            guard.canActivate(mockContext);

            expect(parentCanActivate).toHaveBeenCalledWith(mockContext);
            parentCanActivate.mockRestore();
        });

        it('returns false (via passport) when no Authorization header is present', () => {
            const guard = new JwtAuthGuard();
            const mockContext = {
                switchToHttp: () => ({
                    getRequest: () => ({ headers: {} }),
                }),
                getType: () => 'http',
            } as any;

            const parentCanActivate = jest.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(guard)),
                'canActivate',
            ).mockReturnValue(false as any);

            const result = guard.canActivate(mockContext);

            expect(result).toBe(false);
            parentCanActivate.mockRestore();
        });
    });

    describe('handleRequest', () => {
        const guard = new JwtAuthGuard();

        it('accepts an app-scoped token', () => {
            const user = { userId: 'user-1', scope: 'app' };
            expect(guard.handleRequest(null, user, null, null)).toBe(user);
        });

        it('accepts a legacy token with no scope claim', () => {
            const user = { userId: 'user-1' };
            expect(guard.handleRequest(null, user, null, null)).toBe(user);
        });

        it('rejects a storefront customer token', () => {
            const user = { userId: 'user-1', scope: 'storefront' };
            expect(() => guard.handleRequest(null, user, null, null)).toThrow(UnauthorizedException);
            expect(() => guard.handleRequest(null, user, null, null)).toThrow(
                'This session is not valid for the application API',
            );
        });

        it('still rejects an unauthenticated request', () => {
            expect(() => guard.handleRequest(null, null, null, null)).toThrow(UnauthorizedException);
        });
    });

    /**
     * A password an admin set is known to at least two people from the moment it
     * exists — `EmployeeLoginService` shows it to HR to pass on. The session it
     * opens is therefore good for replacing itself and nothing else, and that is
     * enforced here rather than in the frontend, where it would be a suggestion.
     */
    describe('a session on an admin-set password', () => {
        const guard = new JwtAuthGuard();
        const contextFor = (url: string) => ({
            switchToHttp: () => ({ getRequest: () => ({ originalUrl: url, headers: {} }) }),
            getType: () => 'http',
        }) as any;

        const pending = { userId: 'user-1', scope: 'app', mustChangePassword: true };

        it.each([
            '/api/v1/auth/me',
            '/api/v1/auth/change-password',
            '/api/v1/auth/logout',
            '/api/v1/tenants/password-policy',
        ])('admits %s — the four endpoints the gate itself needs', (url) => {
            expect(guard.handleRequest(null, pending, null, contextFor(url))).toBe(pending);
        });

        it('admits an allowed path carrying a query string', () => {
            expect(
                guard.handleRequest(null, pending, null, contextFor('/api/v1/auth/me?fresh=1')),
            ).toBe(pending);
        });

        it.each([
            '/api/v1/employees',
            '/api/v1/employee-portal/me',
            '/api/v1/sales',
            '/api/v1/auth/2fa/disable',
        ])('refuses %s', (url) => {
            expect(() => guard.handleRequest(null, pending, null, contextFor(url)))
                .toThrow(ForbiddenException);
        });

        it('fails closed when the path cannot be read', () => {
            // A context this guard cannot inspect is not a reason to let the
            // session through — the allowlist is the only thing standing between
            // a shared password and the whole API.
            expect(() => guard.handleRequest(null, pending, null, null))
                .toThrow(ForbiddenException);
        });

        it('leaves a session on a self-chosen password alone', () => {
            const settled = { userId: 'user-1', scope: 'app', mustChangePassword: false };
            expect(guard.handleRequest(null, settled, null, contextFor('/api/v1/sales')))
                .toBe(settled);
        });

        it('says why, so the client can route to the right screen', () => {
            try {
                guard.handleRequest(null, pending, null, contextFor('/api/v1/sales'));
                throw new Error('expected the guard to refuse');
            } catch (error: any) {
                expect(error.getResponse()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
            }
        });
    });
});
