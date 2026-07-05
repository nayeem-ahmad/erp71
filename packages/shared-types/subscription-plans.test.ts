import {
    defaultPlanFeatures,
    isComingSoonSubscriptionPlan,
    isSelfServeSubscriptionPlan,
    mergeAddonFeatures,
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

    describe('mergeAddonFeatures', () => {
        it('grants a boolean entitlement from an active add-on the base plan lacks', () => {
            const base = normalizePlanFeatures({}, 'FREE');
            expect(base.premiumManufacturing).toBe(false);

            const merged = mergeAddonFeatures(base, [{ premiumManufacturing: true }]);
            expect(merged.premiumManufacturing).toBe(true);
        });

        it('never turns off a boolean the base plan already grants', () => {
            const base = normalizePlanFeatures({ premiumManufacturing: true }, 'PREMIUM');
            const merged = mergeAddonFeatures(base, [{ premiumManufacturing: false }]);
            expect(merged.premiumManufacturing).toBe(true);
        });

        it('takes the max of numeric quotas across plan and add-ons', () => {
            const base = normalizePlanFeatures({ maxStores: 2 });
            const merged = mergeAddonFeatures(base, [{ maxStores: 1 }, { maxStores: 5 }]);
            expect(merged.maxStores).toBe(5);
        });

        it('ignores unknown keys and missing/null add-on feature bags', () => {
            const base = normalizePlanFeatures({});
            const merged = mergeAddonFeatures(base, [null, undefined, { notARealKey: true }]);
            expect(merged).toEqual(base);
        });

        it('merges multiple active add-ons together', () => {
            const base = normalizePlanFeatures({}, 'FREE');
            const merged = mergeAddonFeatures(base, [
                { premiumManufacturing: true },
                { premiumStorefront: true },
            ]);
            expect(merged.premiumManufacturing).toBe(true);
            expect(merged.premiumStorefront).toBe(true);
            expect(merged.premiumBookPublishing).toBe(false);
        });
    });
});