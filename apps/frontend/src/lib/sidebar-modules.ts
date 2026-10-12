import type { AppState, NavLayoutNode } from '@erp71/shared-types';
import { isItemVisible } from '@/lib/nav-visibility';
import { filterNavByPermissions } from '@/lib/nav-permission-filter';
import { buildNavModulesFromLayout, type ResolvedNavChild, type ResolvedNavModule } from '@/lib/nav-resolver';
import { routes } from '@/lib/routes';

/**
 * Account-settings ("Admin") links that stay relevant to an accounting-only
 * subscription. Everything else in the module is retail/POS/marketing and is
 * hidden in `accountingOnlyMode`. Keep this in sync with the accounting-only
 * settings route allow-list in `@/lib/accounting-only-paths`.
 */
const ACCOUNTING_ONLY_ADMIN_LINK_HREFS: ReadonlySet<string> = new Set([
    routes.settings.root, // My Account
    routes.profile, // My Profile
    routes.team, // Team & Permissions
    routes.settings.auditLogs, // Audit Logs
    routes.settings.localization, // Localization
    routes.settings.tax, // Tax / VAT
    routes.settings.data, // Data Management
    routes.billing, // Billing
]);

export function isNavSubgroup(child: ResolvedNavChild): child is Extract<ResolvedNavChild, { type: 'subgroup' }> {
    return 'type' in child && child.type === 'subgroup';
}

function canAccessModuleAdvancedReports(
    moduleKey: string,
    canAccessInventoryReports: boolean,
    canAccessAccountingAdvanced: boolean,
): boolean {
    if (moduleKey === 'accounting') {
        return canAccessAccountingAdvanced;
    }
    return canAccessInventoryReports;
}

function stripPosNavLink(children: ResolvedNavChild[], posEnabled: boolean): ResolvedNavChild[] {
    if (posEnabled) return children;
    return children
        .map((child) => {
            if (!isNavSubgroup(child)) {
                return child.href === routes.sales.pos ? null : child;
            }
            const filteredLinks = child.children.filter((link) => link.href !== routes.sales.pos);
            if (filteredLinks.length === 0) return null;
            return { ...child, children: filteredLinks };
        })
        .filter((child): child is ResolvedNavChild => child !== null);
}

function filterModuleNavChildren(
    children: ResolvedNavChild[],
    moduleKey: string,
    canAccessInventoryReports: boolean,
    canAccessAccountingAdvanced: boolean,
    canAccessPremiumCrm = false,
    planFeatures: Record<string, unknown> = {},
): ResolvedNavChild[] {
    const canAccessAdvanced = canAccessModuleAdvancedReports(
        moduleKey,
        canAccessInventoryReports,
        canAccessAccountingAdvanced,
    );
    return children
        .map((child) => {
            if (!isNavSubgroup(child)) {
                if (child.premiumOnly && !canAccessPremiumCrm) return null;
                if (child.entitlement && !isItemVisible(child, planFeatures)) return null;
                return !child.advancedOnly || canAccessAdvanced ? child : null;
            }
            if (child.advancedOnly && !canAccessAdvanced) return null;
            if (child.entitlement && !isItemVisible(child, planFeatures)) return null;
            const filteredLinks = child.children.filter((link) => {
                if (link.premiumOnly && !canAccessPremiumCrm) return false;
                if (link.entitlement && !isItemVisible(link, planFeatures)) return false;
                return !link.advancedOnly || canAccessAdvanced;
            });
            if (filteredLinks.length === 0) return null;
            return { ...child, children: filteredLinks };
        })
        .filter((child): child is ResolvedNavChild => child !== null);
}

/** Everything the layout-driven sidebar needs to decide what to show. */
export interface SidebarModulesInput {
    tenantLayout: NavLayoutNode[];
    platformAdminLayout: NavLayoutNode[];
    /** The active locale's message dictionary (`t`). */
    messages: Record<string, unknown>;
    /**
     * Module-level gate for the tenant shell, from `resolveAppStates`. The shell
     * always passes it; without it the legacy per-module props below decide,
     * which only callers that predate the registry (tests) still rely on.
     */
    appStates?: Readonly<Record<string, AppState>>;
    canAccessAccounting?: boolean;
    canAccessInventoryReports?: boolean;
    canAccessAccountingAdvanced?: boolean;
    canAccessPremiumCrm?: boolean;
    canAccessManufacturing?: boolean;
    canAccessProjects?: boolean;
    canAccessPlatformAccounting?: boolean;
    canAccessAdmin?: boolean;
    canManageBilling?: boolean;
    canManageTeam?: boolean;
    canManageShortLinks?: boolean;
    platformAdminMode?: boolean;
    helpEnabled?: boolean;
    supportEnabled?: boolean;
    accountingOnlyMode?: boolean;
    posEnabled?: boolean;
    planFeatures?: Record<string, unknown>;
    memberPermissions?: readonly string[];
    memberIsOwner?: boolean;
}

/**
 * The legacy module gate. Kept only for callers that pass no `appStates`; the
 * shell passes them, so production reads `resolveAppStates` alone. Retire this
 * with the old sidebar once `appShell` is the default.
 */
function legacyModuleGate(module: ResolvedNavModule, input: SidebarModulesInput): boolean {
    const planFeatures = input.planFeatures ?? {};
    if (input.accountingOnlyMode) {
        if (module.key === 'help') return Boolean(input.helpEnabled);
        if (module.key === 'support') return Boolean(input.supportEnabled);
        // Expenses split out of Accounting but its pages still live
        // under /accounting/expenses — same gate, same plan.
        if (module.key === 'accounting' || module.key === 'expenses') return input.canAccessAccounting ?? true;
        return ['dashboard', 'account-settings'].includes(module.key);
    }
    if (module.key === 'accounting' || module.key === 'expenses') return input.canAccessAccounting ?? true;
    if (module.key === 'admin') return Boolean(input.canAccessAdmin);
    if (module.key === 'help') return Boolean(input.helpEnabled);
    if (module.key === 'support') return Boolean(input.supportEnabled);
    if (module.key === 'manufacturing') return Boolean(input.canAccessManufacturing);
    if (module.key === 'projects') return Boolean(input.canAccessProjects);
    // Module-level entitlement from NAV_REGISTRY. Declared for `chat`
    // since team chat shipped, but silently dropped in resolution until
    // now, so the module rendered on every plan and 403'd on entry.
    return isItemVisible(module, planFeatures);
}

/**
 * The layout-driven sidebar's modules — the admin console's, or a shop's —
 * with plan, platform, app and permission gates applied. Shared by the old
 * sidebar, the app rail and the Home tiles so the three can never disagree
 * about what a member may open.
 */
export function resolveSidebarModules(input: SidebarModulesInput): ResolvedNavModule[] {
    const {
        platformAdminMode = false,
        canAccessInventoryReports = false,
        canAccessAccountingAdvanced = false,
        canAccessPremiumCrm = false,
        canAccessProjects = false,
        canAccessPlatformAccounting = false,
        canManageBilling = false,
        canManageTeam = false,
        canManageShortLinks = false,
        helpEnabled = false,
        accountingOnlyMode = false,
        posEnabled = true,
        planFeatures = {},
        appStates,
    } = input;

    const sourceLayout = platformAdminMode ? input.platformAdminLayout : input.tenantLayout;
    const resolved = buildNavModulesFromLayout(sourceLayout, input.messages)
        .filter((module) => {
            if (platformAdminMode) {
                if (module.key === 'help') return helpEnabled;
                // The platform team's own project workspace, the one shop
                // module the admin console carries. Its own switch decides,
                // which the shell has already resolved into this prop.
                if (module.key === 'projects') return canAccessProjects;
                return module.key === 'admin';
            }
            if (appStates) {
                const state = appStates[module.key];
                // Dashboard (Home) is not an app; neither is a module added to
                // the registry after this build — those fall back to their own
                // entitlement, as every module did before.
                if (state === undefined) return isItemVisible(module, planFeatures);
                return state === 'available';
            }
            return legacyModuleGate(module, input);
        })
        .map((module) => {
            if (!module.children) return module;

            if (module.key === 'account-settings') {
                return {
                    ...module,
                    children: module.children.filter((child) => {
                        if (isNavSubgroup(child)) return true;
                        if (accountingOnlyMode && !ACCOUNTING_ONLY_ADMIN_LINK_HREFS.has(child.href)) {
                            return false;
                        }
                        // Plan entitlements from NAV_REGISTRY. This branch never ran the
                        // generic filter the retail modules use, so without this an
                        // entitlement on an Admin link (the URL shortener's) was dead config.
                        if (child.entitlement && !isItemVisible(child, planFeatures)) return false;
                        if (child.href === routes.billing) return canManageBilling;
                        if (child.href === routes.team || child.href === routes.settings.auditLogs) {
                            return canManageTeam;
                        }
                        if (child.href === routes.settings.urlShortener) return canManageShortLinks;
                        return true;
                    }),
                };
            }

            // The admin console carries one subgroup behind a platform
            // switch. Filtered here rather than by the generic entitlement
            // path, which reads a tenant's plan — the platform has none.
            if (module.key === 'admin' && !canAccessPlatformAccounting) {
                return {
                    ...module,
                    children: module.children.filter(
                        // `key` is the registry id's last segment — see
                        // buildNavModulesFromLayout — so this matches the
                        // `admin.platform-accounting` subgroup.
                        (child) => !(isNavSubgroup(child) && child.key === 'platform-accounting'),
                    ),
                };
            }

            if (['sales', 'purchase', 'imports', 'inventory', 'accounting'].includes(module.key)) {
                const filteredChildren = filterModuleNavChildren(
                    module.children,
                    module.key,
                    canAccessInventoryReports,
                    canAccessAccountingAdvanced,
                    canAccessPremiumCrm,
                    planFeatures,
                );
                return {
                    ...module,
                    children: module.key === 'sales'
                        ? stripPosNavLink(filteredChildren, posEnabled)
                        : filteredChildren,
                };
            }

            if (module.key === 'crm') {
                return {
                    ...module,
                    children: filterModuleNavChildren(
                        module.children,
                        module.key,
                        true,
                        true,
                        canAccessPremiumCrm,
                        planFeatures,
                    ),
                };
            }

            return module;
        })
        .filter((module) => !module.children || module.children.length > 0);

    // Last, so the plan and feature gates above have already run and this only
    // has to remove what the member holds no permission for.
    return input.memberPermissions && !platformAdminMode
        ? filterNavByPermissions(resolved, {
            isOwner: input.memberIsOwner ?? false,
            permissions: input.memberPermissions,
        })
        : resolved;
}
