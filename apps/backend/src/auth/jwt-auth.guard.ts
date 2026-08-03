import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isStorefrontScope } from './token-scope';

/**
 * Standard bearer auth for the ERP app.
 *
 * Storefront customer tokens are minted from the same `User` row and signed with
 * the same secret, so they are rejected here explicitly — a shopper signing in at
 * `/storefront/:slug/auth/login` must not end up holding an app session. Use
 * `StorefrontCustomerGuard` for the customer portal instead.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    handleRequest<TUser = any>(err: any, user: any, info: any, context: any, status?: any): TUser {
        const resolved = super.handleRequest<TUser>(err, user, info, context, status);

        if (isStorefrontScope((resolved as any)?.scope)) {
            throw new UnauthorizedException('This session is not valid for the application API');
        }

        return resolved;
    }
}
