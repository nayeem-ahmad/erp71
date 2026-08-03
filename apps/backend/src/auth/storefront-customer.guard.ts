import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isStorefrontScope } from './token-scope';

/**
 * Bearer auth for the storefront customer portal.
 *
 * The mirror of `JwtAuthGuard`: only tokens minted by the storefront login pass,
 * so an owner's app session cannot be used to read the customer-facing profile
 * and order history endpoints.
 */
@Injectable()
export class StorefrontCustomerGuard extends AuthGuard('jwt') {
    handleRequest<TUser = any>(err: any, user: any, info: any, context: any, status?: any): TUser {
        const resolved = super.handleRequest<TUser>(err, user, info, context, status);

        if (!isStorefrontScope((resolved as any)?.scope)) {
            throw new UnauthorizedException('Sign in to this store to continue');
        }

        return resolved;
    }
}
