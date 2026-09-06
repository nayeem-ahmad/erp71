import { SUBSCRIPTION_PLAN_CODES } from '@erp71/shared-types';
import { MARKETING_PLANS, ACCOUNTING_EDITION } from './plans';
import { PLAN_TERMS_ADDENDA, planTermsAddendumForCode, resolvePlanTermsSlug } from './plan-terms';

describe('plan terms addenda', () => {
    it('covers every published tier', () => {
        // Enterprise has no plan code — it is on the pricing page but not in the
        // enum — so the published set is the marketing ladder plus accounting.
        const published = [
            ...MARKETING_PLANS.map((plan) => plan.id),
            'accounting',
        ].sort();
        expect(PLAN_TERMS_ADDENDA.map((addendum) => addendum.slug).sort()).toEqual(published);
    });

    it('resolves every self-serve plan code a signup can send', () => {
        // FREE is not sold, and every other code must land on an addendum, or a
        // subscriber would tick a box agreeing to terms that do not exist.
        for (const code of SUBSCRIPTION_PLAN_CODES) {
            if (code === 'FREE') continue;
            expect(planTermsAddendumForCode(code)).not.toBeNull();
        }
    });

    it('keeps the renamed marketing slugs pointing at the right tier', () => {
        // Still live in ad campaigns and bookmarks — see PLAN_TERMS_ALIASES.
        expect(resolvePlanTermsSlug('basic')).toBe('starter');
        expect(resolvePlanTermsSlug('STANDARD')).toBe('growth');
        expect(resolvePlanTermsSlug('premium')).toBe('business');
    });

    it('resolves nothing for an unknown or absent plan', () => {
        expect(resolvePlanTermsSlug('gold')).toBeNull();
        expect(resolvePlanTermsSlug(null)).toBeNull();
        expect(resolvePlanTermsSlug('')).toBeNull();
    });

    it('restates no price, capacity or inclusion', () => {
        // Section 4 of the terms deliberately carries no price table because the
        // document's own copy of the tiers drifted until every figure was wrong.
        // The addenda must not reintroduce the same problem.
        const prose = PLAN_TERMS_ADDENDA
            .flatMap((addendum) => [addendum.summary, ...addendum.clauses.flatMap((c) => [c.title, c.body])])
            .join(' ');

        const figures = [
            ...MARKETING_PLANS.flatMap((plan) => [plan.monthlyPrice, plan.yearlyPrice, plan.setupFee]),
            ACCOUNTING_EDITION.monthlyPrice,
            ACCOUNTING_EDITION.yearlyPrice,
        ].filter((value) => value > 0);

        for (const figure of figures) {
            expect(prose).not.toContain(String(figure));
        }
        expect(prose).not.toMatch(/\bBDT\b|৳/);
    });

    it('gives every tier at least one clause', () => {
        for (const addendum of PLAN_TERMS_ADDENDA) {
            expect(addendum.clauses.length).toBeGreaterThan(0);
            expect(addendum.summary.trim()).not.toBe('');
        }
    });
});
