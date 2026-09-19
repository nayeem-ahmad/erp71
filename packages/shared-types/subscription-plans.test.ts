import {
    defaultPlanFeatures,
    isComingSoonSubscriptionPlan,
    isSelfServeSubscriptionPlan,
    mergeAddonFeatures,
    normalizePlanFeatures,
    NON_PROJECT_MODULE_READ_PERMISSIONS,
    parsePlanFeatures,
    resolveAiCreditsMonthly,
    resolveDashboardVariant,
    resolvePlanRank,
} from './subscription-plans';
import { StorePermission, TENANT_ROLE_TEMPLATES } from './index';

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

    it('sells Premium self-serve', () => {
        // Business opened for self-serve on 2026-09-07. The coming-soon list is
        // now empty but deliberately kept — see the comment on the constant.
        expect(isComingSoonSubscriptionPlan('PREMIUM')).toBe(false);
        expect(isSelfServeSubscriptionPlan('PREMIUM', 2499)).toBe(true);
        expect(isSelfServeSubscriptionPlan('STANDARD', 999)).toBe(true);
    });

    it('still refuses the plans that were never self-serve', () => {
        // The two exclusions that are not about coming-soon status: FREE is
        // retired, and any plan priced at zero is not something to sell.
        expect(isSelfServeSubscriptionPlan('FREE', 0)).toBe(false);
        expect(isSelfServeSubscriptionPlan('PREMIUM', 0)).toBe(false);
        expect(isSelfServeSubscriptionPlan('ENTERPRISE', 8000)).toBe(false);
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

    describe('resolveDashboardVariant', () => {
        const LEDGER = ['VIEW_LEDGER'];

        it('follows the plan default when the tenant has expressed no preference', () => {
            const retail = normalizePlanFeatures({ premiumAccounting: true }, 'STANDARD');
            expect(resolveDashboardVariant('AUTO', retail, LEDGER)).toBe('RETAIL');

            const accounting = normalizePlanFeatures(
                { premiumAccounting: true, accountingDashboard: true },
                'STANDARD',
            );
            expect(resolveDashboardVariant('AUTO', accounting, LEDGER)).toBe('ACCOUNTING');
        });

        it('lets a tenant opt in to the accounting dashboard on a retail plan', () => {
            const features = normalizePlanFeatures({ premiumAccounting: true }, 'STANDARD');
            expect(resolveDashboardVariant('ACCOUNTING', features, LEDGER)).toBe('ACCOUNTING');
        });

        it('lets a tenant opt out of a plan that defaults to accounting', () => {
            const features = normalizePlanFeatures(
                { premiumAccounting: true, accountingDashboard: true },
                'STANDARD',
            );
            expect(resolveDashboardVariant('RETAIL', features, LEDGER)).toBe('RETAIL');
        });

        it('refuses the accounting dashboard without the accounting module', () => {
            const features = normalizePlanFeatures({}, 'BASIC');
            expect(resolveDashboardVariant('ACCOUNTING', features, LEDGER)).toBe('RETAIL');
        });

        it('refuses the accounting dashboard for a user who cannot read the ledger', () => {
            const features = normalizePlanFeatures(
                { premiumAccounting: true, accountingDashboard: true },
                'STANDARD',
            );
            expect(resolveDashboardVariant('AUTO', features, ['CREATE_SALE'])).toBe('RETAIL');
            expect(resolveDashboardVariant('AUTO', features)).toBe('RETAIL');
        });

        it('pins accounting-only tenants to the accounting dashboard', () => {
            const features = normalizePlanFeatures(
                { premiumAccounting: true, accountingOnly: true, accountingDashboard: true },
                'ACCOUNTING',
            );
            // No retail modules, routes or data exist for these tenants, so neither
            // an explicit preference nor a missing permission can move them.
            expect(resolveDashboardVariant('RETAIL', features, LEDGER)).toBe('ACCOUNTING');
            expect(resolveDashboardVariant('AUTO', features, [])).toBe('ACCOUNTING');
        });

        it('ignores an unrecognised stored preference', () => {
            const features = normalizePlanFeatures({ premiumAccounting: true }, 'STANDARD');
            expect(resolveDashboardVariant('SOMETHING_ELSE', features, LEDGER)).toBe('RETAIL');
            expect(resolveDashboardVariant(null, features, LEDGER)).toBe('RETAIL');
        });

        describe('the projects-only member', () => {
            const PROJECT_USER = ['VIEW_PROJECTS', 'MANAGE_PROJECT_TASKS', 'LOG_PROJECT_TIME', 'USE_TEAM_CHAT'];
            const retail = () => normalizePlanFeatures({ premiumAccounting: true }, 'STANDARD');

            it('lands a projects-only member on the projects dashboard', () => {
                expect(resolveDashboardVariant('AUTO', retail(), PROJECT_USER)).toBe('PROJECTS');
            });

            it('ignores the tenant preference, which cannot select this variant', () => {
                // Earned by permissions, never chosen: a workspace must not be able to
                // put everyone on one member's personal dashboard.
                expect(resolveDashboardVariant('ACCOUNTING', retail(), PROJECT_USER)).toBe('PROJECTS');
                expect(resolveDashboardVariant('RETAIL', retail(), PROJECT_USER)).toBe('PROJECTS');
            });

            it('drops back to the plan default when the member reads any other module', () => {
                for (const extra of NON_PROJECT_MODULE_READ_PERMISSIONS) {
                    expect(resolveDashboardVariant('AUTO', retail(), [...PROJECT_USER, extra])).toBe('RETAIL');
                }
            });

            it('does not move an accounting-only tenant, which has no projects routes', () => {
                const features = normalizePlanFeatures(
                    { premiumAccounting: true, accountingOnly: true },
                    'ACCOUNTING',
                );
                expect(resolveDashboardVariant('AUTO', features, PROJECT_USER)).toBe('ACCOUNTING');
            });

            it('leaves a member with no projects permission alone', () => {
                expect(resolveDashboardVariant('AUTO', retail(), ['CREATE_SALE'])).toBe('RETAIL');
                expect(resolveDashboardVariant('AUTO', retail(), [])).toBe('RETAIL');
            });

            it('lists only real permissions, so a rename breaks the build not the gate', () => {
                for (const permission of NON_PROJECT_MODULE_READ_PERMISSIONS) {
                    expect(StorePermission[permission as keyof typeof StorePermission]).toBe(permission);
                }
            });

            it('closes the loop against the real role templates: only Projects roles land here', () => {
                // NON_PROJECT_MODULE_READ_PERMISSIONS is a hand-maintained denylist.
                // This test does not trust it — it unions every seeded role template
                // with a Project User's permissions and checks the *outcome*, so a
                // missing entry (like the VIEW_IMPORTS/VIEW_BLOG omission this test
                // was added to catch) fails here even if no one thought to add a
                // dedicated case for that module.
                const features = normalizePlanFeatures({ premiumAccounting: true }, 'STANDARD');

                const wronglyProjects: string[] = [];
                const wronglyNotRetail: string[] = [];

                for (const template of TENANT_ROLE_TEMPLATES) {
                    const union = Array.from(new Set([...template.permissions, ...PROJECT_USER]));
                    const variant = resolveDashboardVariant('AUTO', features, union);

                    if (template.module === 'Projects') {
                        if (variant !== 'PROJECTS') wronglyNotRetail.push(template.key);
                    } else {
                        if (variant === 'PROJECTS') wronglyProjects.push(template.key);
                    }
                }

                expect(wronglyProjects).toEqual([]);
                expect(wronglyNotRetail).toEqual([]);
            });
        });
    });
});
