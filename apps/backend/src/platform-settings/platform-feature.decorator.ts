import { SetMetadata } from '@nestjs/common';
import type { PlatformFeatures } from '@erp71/shared-types';

export const REQUIRES_PLATFORM_FEATURE_KEY = 'requires_platform_feature';

/** Gates a controller/handler behind a platform-admin on/off switch (independent of plan/tenant). */
export const RequiresPlatformFeature = (feature: keyof PlatformFeatures) =>
    SetMetadata(REQUIRES_PLATFORM_FEATURE_KEY, feature);
