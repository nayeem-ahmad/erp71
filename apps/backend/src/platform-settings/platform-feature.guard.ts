import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformFeatures } from '@erp71/shared-types';
import { PlatformSettingsService } from './platform-settings.service';
import { REQUIRES_PLATFORM_FEATURE_KEY } from './platform-feature.decorator';

/** Blocks access when a platform admin has switched the required feature off, regardless of plan. */
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

        const enabled = await this.platformSettings.isFeatureEnabled(feature);
        if (!enabled) {
            throw new ForbiddenException('This feature has been disabled by the platform administrator.');
        }

        return true;
    }
}
