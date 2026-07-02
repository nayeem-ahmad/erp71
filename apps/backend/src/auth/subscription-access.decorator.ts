import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_PLAN_KEY = 'subscription_plan';
export const SUBSCRIPTION_FEATURE_KEY = 'subscription_feature';
export const SUBSCRIPTION_EXTRA_FEATURES_KEY = 'subscription_extra_features';

export const RequiresPlan = (planCode: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM') =>
	SetMetadata(SUBSCRIPTION_PLAN_KEY, planCode);

export const RequiresFeature = (featureKey: string) =>
	SetMetadata(SUBSCRIPTION_FEATURE_KEY, featureKey);

/** Additional entitlements required on top of the controller-level @RequiresFeature. */
export const RequiresAdditionalFeature = (...featureKeys: string[]) =>
	SetMetadata(SUBSCRIPTION_EXTRA_FEATURES_KEY, featureKeys);