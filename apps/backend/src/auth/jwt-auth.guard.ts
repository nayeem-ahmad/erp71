import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AUTH_SCOPE_APP, resolveAuthScope } from './token-scope';

/**
 * Paths a session with an unreplaced admin-set password may still reach.
 *
 * Deliberately tiny, and each one earns its place: `auth/me` because the app
 * shell cannot render the "set your password" screen without knowing who it is
 * talking to, `tenants/password-policy` because that screen shows the
 * workspace's own rules as a live checklist, `auth/change-password` because it
 * is the way out, and `auth/logout` because refusing to let someone leave is
 * not a security property.
 *
 * Compared against the path with the global prefix stripped, so it does not
 * silently stop matching if `api/v1` is ever versioned up.
 */
const PASSWORD_CHANGE_ALLOWLIST = new Set([
    'auth/me',
    'auth/change-password',
    'auth/logout',
    'tenants/password-policy',
]);

/** `/api/v1/auth/me?x=1` → `auth/me`. */
function normalizePath(rawUrl: string): string {
    const path = (rawUrl || '').split('?')[0];
    return path
        .replace(/^\/+/, '')
        .replace(/^api\/v\d+\//, '')
        .replace(/\/+$/, '');
}

/**
 * Standard bearer auth for the ERP app.
 *
 * Storefront customer and careers-portal tokens are minted from the same `User`
 * row and signed with the same secret, so they must be rejected here — a shopper
 * signing in at `/storefront/:slug/auth/login`, or a job applicant signing in at
 * `/careers/auth/login`, must not end up holding an app session. Use
 * `StorefrontCustomerGuard` and `ApplicantGuard` for those surfaces instead.
 *
 * Written as an allowlist rather than a list of scopes to bar: the applicant
 * scope was the second non-app surface, and a deny-list only stays correct if
 * every future one remembers to amend this file. `resolveAuthScope` maps a
 * missing claim to `app`, so pre-scope tokens still pass.
 *
 * **The second thing this does** is hold a session to changing its password when
 * an admin set it. `EmployeeLoginService` generates a password and shows it to
 * HR, so from the moment it exists at least two people know it; it is meant to
 * get the employee in once and no further. Enforcing that here rather than in
 * the frontend is the difference between a prompt and a rule — the check costs
 * nothing, because `JwtStrategy` has already loaded the row that carries the
 * flag.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    handleRequest<TUser = any>(err: any, user: any, info: any, context: any, status?: any): TUser {
        const resolved = super.handleRequest<TUser>(err, user, info, context, status);

        if (resolveAuthScope((resolved as any)?.scope) !== AUTH_SCOPE_APP) {
            throw new UnauthorizedException('This session is not valid for the application API');
        }

        if ((resolved as any)?.mustChangePassword) {
            const request = context?.switchToHttp?.().getRequest?.();
            const path = normalizePath(request?.originalUrl ?? request?.url ?? '');
            if (!PASSWORD_CHANGE_ALLOWLIST.has(path)) {
                throw new ForbiddenException({
                    code: 'PASSWORD_CHANGE_REQUIRED',
                    message: 'Set your own password before using the app.',
                });
            }
        }

        return resolved;
    }
}
