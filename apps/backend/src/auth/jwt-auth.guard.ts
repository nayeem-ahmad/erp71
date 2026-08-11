import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AUTH_SCOPE_APP, resolveAuthScope } from './token-scope';

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
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    handleRequest<TUser = any>(err: any, user: any, info: any, context: any, status?: any): TUser {
        const resolved = super.handleRequest<TUser>(err, user, info, context, status);

        if (resolveAuthScope((resolved as any)?.scope) !== AUTH_SCOPE_APP) {
            throw new UnauthorizedException('This session is not valid for the application API');
        }

        return resolved;
    }
}
