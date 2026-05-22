import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyGuard } from './api-key.guard';

/**
 * Combined authentication guard for public-facing endpoints.
 * Tries JWT bearer authentication first; if that fails, tries x-api-key
 * authentication. Allows the request if either method succeeds.
 * Attaches req.tenantId when the API-key path is used.
 *
 * NOTE: This guard is for future use on public endpoints.
 * Existing internal endpoints continue to use JwtAuthGuard directly.
 */
@Injectable()
export class CombinedAuthGuard implements CanActivate {
    constructor(
        private readonly jwtGuard: JwtAuthGuard,
        private readonly apiKeyGuard: ApiKeyGuard,
        private readonly reflector: Reflector,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // --- Try JWT first ---
        try {
            const jwtResult = await Promise.resolve(this.jwtGuard.canActivate(context));
            if (jwtResult) {
                return true;
            }
        } catch {
            // JWT auth failed — fall through to API key
        }

        // --- Try API key ---
        try {
            const apiKeyResult = await Promise.resolve(this.apiKeyGuard.canActivate(context));
            if (apiKeyResult) {
                const request = context.switchToHttp().getRequest();
                const user: { tenantId: string; apiKeyId: string } = request.user;
                if (user?.tenantId) {
                    request.tenantId = user.tenantId;
                }
                return true;
            }
        } catch {
            // API key auth also failed
        }

        throw new UnauthorizedException('Authentication required');
    }
}
