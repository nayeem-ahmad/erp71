import {
    defaultPlanFeatures,
    isComingSoonSubscriptionPlan,
    isSelfServeSubscriptionPlan,
    normalizePlanFeatures,
    parsePlanFeatures,
    resolveAiCreditsMonthly,
    resolvePlanRank,
} from './subscription-plans';

describe('subscription-plans helpers', () => {
    it('fills missing entitlements with defaults', () => {
        const normalized = normalizePlanFeatures({ premiumAccounting: true, maxStores: 3 });
        expect(normalized.premiumAccounting).toBe(true);
        expect(normalized.maxStores).toBe(3);
        expect(normalized.maxUsers).toBe(defaultPlanFeatures().maxUsers);
    });

    it('parses and validates a complete feature set', () => {
        const parsed = parsePlanFeatures(defaultPlanFeatures());
        expect(parsed.maxSkus).toBe(100);
        expect(parsed.apiAccess).toBe(false);
    });

    it('resolves plan rank and AI credits from legacy plan codes', () => {
        const features = normalizePlanFeatures({}, 'STANDARD');
        expect(resolvePlanRank(features, 'STANDARD')).toBe(2);
        expect(resolveAiCreditsMonthly(features, 'STANDARD')).toBe(500);
    });

    it('treats Premium as coming soon and not self-serve', () => {
        expect(isComingSoonSubscriptionPlan('PREMIUM')).toBe(true);
        expect(isSelfServeSubscriptionPlan('PREMIUM', 1499)).toBe(false);
        expect(isSelfServeSubscriptionPlan('STANDARD', 999)).toBe(true);
    });

    it('reads granular entitlements from normalized features', () => {
        const features = normalizePlanFeatures({
            premiumAccountingAdvanced: true,
            premiumAi: false,
            premiumVoice: true,
        });
        expect(features.premiumAccountingAdvanced).toBe(true);
        expect(features.premiumAi).toBe(false);
        expect(features.premiumVoice).toBe(true);
    });
});