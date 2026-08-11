import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DatabaseService } from '../database/database.service';
import { AUTH_SCOPE_APPLICANT, AUTH_SCOPE_STOREFRONT, resolveAuthScope } from './token-scope';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private db: DatabaseService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET || 'fallback-secret-for-dev-only',
            passReqToCallback: false,
        });
    }

    async validate(payload: any) {
        const user = await this.db.user.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                email: true,
                token_version: true,
                storefront_token_version: true,
                applicant_token_version: true,
                is_platform_admin: true,
            },
        });

        if (!user) throw new UnauthorizedException('User not found');

        const scope = resolveAuthScope(payload.scope);

        // Reject tokens issued before a password change or logout. The three
        // surfaces revoke independently: `tv` tracks the ERP app, `stv` the
        // storefront customer portal, `atv` the careers portal.
        if (scope === AUTH_SCOPE_STOREFRONT) {
            if (payload.stv !== undefined && payload.stv !== user.storefront_token_version) {
                throw new UnauthorizedException('Session invalidated');
            }
        } else if (scope === AUTH_SCOPE_APPLICANT) {
            if (payload.atv !== undefined && payload.atv !== user.applicant_token_version) {
                throw new UnauthorizedException('Session invalidated');
            }
        } else if (payload.tv !== undefined && payload.tv !== user.token_version) {
            throw new UnauthorizedException('Session invalidated');
        }

        return {
            userId: user.id,
            email: user.email,
            isPlatformAdmin: user.is_platform_admin,
            scope,
            // Storefront tokens are bound to the tenant they were issued for, so
            // a session at one shop cannot read a profile at another.
            storefrontTenantId: scope === AUTH_SCOPE_STOREFRONT ? (payload.tid ?? null) : null,
        };
    }
}
