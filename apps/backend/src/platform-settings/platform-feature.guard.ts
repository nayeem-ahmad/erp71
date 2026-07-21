import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformFeatures } from '@erp71/shared-types';
import { PlatformSettingsService } from './platform-settings.service';
import { REQUIRES_PLATFORM_FEATURE_KEY } from './platform-feature.decorator';

/**
 * Blocks access when the required feature is switched off for the caller's tenant,
 * regardless of plan — either by the platform default or a per-tenant override.
 */
@Injectable()
export class PlatformFeatureGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly platformSettings: PlatformSettingsService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const feature = this.reflector.getAllAndOverride<keyof PlatformFeatures | undefined>(
            REQUIRES_PLATFORM_FEATURE_KEY,
            [context.getHandler(), context.getClass()],
        );

        if (!feature) return true;

        // Guards run before interceptors, so `request.tenantId` is usually still
        // unset here — fall back to the header. Trusting it is safe: an id the
        // caller isn't a member of is rejected by TenantInterceptor moments later,
        // so the worst a forged header buys is a feature check on a tenant whose
        // data the request can never reach.
        const request = context.switchToHttp().getRequest();
        const tenantId: string | undefined = request.tenantId ?? request.headers?.['x-tenant-id'];
        const enabled = await this.platformSettings.isFeatureEnabledForTenant(feature, tenantId);
        if (!enabled) {
            throw new ForbiddenException('This feature has been disabled by the platform administrator.');
        }

        return true;
    }
}
