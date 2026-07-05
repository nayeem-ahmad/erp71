import { routes } from './routes';

const RETAIL_PATH_PREFIXES = [
    routes.sales.root,
    routes.purchases.root,
    routes.inventory.root,
    routes.crm.root,
    routes.hr.root,
    routes.storefront.root,
    routes.settings.root,
] as const;

/**
 * Account-settings ("Admin") pages that stay accessible under an
 * accounting-only subscription. `routes.settings.root` (My Account) is matched
 * exactly so retail settings pages like `/settings/loyalty` remain blocked.
 * Keep in sync with `ACCOUNTING_ONLY_ADMIN_LINK_HREFS` in the sidebar.
 */
const ACCOUNTING_ALLOWED_SETTINGS_PREFIXES = [
    routes.settings.auditLogs,
    routes.settings.localization,
    routes.settings.tax,
    routes.settings.data,
] as const;

function matchesPath(pathname: string, base: string): boolean {
    return pathname === base || pathname.startsWith(`${base}/`);
}

/** True when pathname is outside the accounting-only workspace. */
export function isAccountingOnlyBlockedPath(pathname: string): boolean {
    // My Account overview and the accounting-relevant settings pages stay open.
    if (pathname === routes.settings.root) return false;
    if (ACCOUNTING_ALLOWED_SETTINGS_PREFIXES.some((base) => matchesPath(pathname, base))) {
        return false;
    }
    return RETAIL_PATH_PREFIXES.some((prefix) => matchesPath(pathname, prefix));
}