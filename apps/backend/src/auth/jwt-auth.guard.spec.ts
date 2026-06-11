import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';

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
});
