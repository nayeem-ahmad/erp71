import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RefereeGuard } from './referee.guard';

/**
 * The guard is the only thing standing between a signed-in tenant user and the
 * partner earnings portal, so the negative cases matter as much as the happy one.
 */
describe('RefereeGuard', () => {
    const referrals = { resolveActiveRefereeForUser: jest.fn() } as any;
    let guard: RefereeGuard;

    const contextFor = (request: Record<string, unknown>) =>
        ({
            switchToHttp: () => ({ getRequest: () => request }),
        }) as unknown as ExecutionContext;

    beforeEach(() => {
        jest.resetAllMocks();
        guard = new RefereeGuard(referrals);
    });

    it('attaches the resolved referee and coerces the decimal rates to numbers', async () => {
        referrals.resolveActiveRefereeForUser.mockResolvedValue({
            id: 'referee-1',
            name: 'Rahman Traders',
            email: 'rahman@example.com',
            referral_code: 'RAHMA1B2C3',
            signup_discount: '7.50',
            commission_rate: '12.25',
            is_active: true,
            user_id: 'user-1',
        });
        const request: Record<string, any> = { user: { userId: 'user-1', email: 'rahman@example.com' } };

        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

        expect(referrals.resolveActiveRefereeForUser).toHaveBeenCalledWith('user-1', 'rahman@example.com');
        expect(request.referee).toEqual(
            expect.objectContaining({
                id: 'referee-1',
                signup_discount: 7.5,
                commission_rate: 12.25,
            }),
        );
    });

    it('rejects an unauthenticated request', async () => {
        await expect(guard.canActivate(contextFor({}))).rejects.toThrow(UnauthorizedException);
        expect(referrals.resolveActiveRefereeForUser).not.toHaveBeenCalled();
    });

    it('rejects a token carrying a user id but no email', async () => {
        await expect(
            guard.canActivate(contextFor({ user: { userId: 'user-1' } })),
        ).rejects.toThrow(UnauthorizedException);
        expect(referrals.resolveActiveRefereeForUser).not.toHaveBeenCalled();
    });

    it('forbids a signed-in user who is not an active referee', async () => {
        referrals.resolveActiveRefereeForUser.mockResolvedValue(null);
        const request: Record<string, any> = { user: { userId: 'user-1', email: 'shopowner@example.com' } };

        await expect(guard.canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
        expect(request.referee).toBeUndefined();
    });
});
