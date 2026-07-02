import {
    defaultPlanFeatures,
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
});