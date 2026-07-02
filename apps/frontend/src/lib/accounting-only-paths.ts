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

/** True when pathname is outside the accounting-only workspace. */
export function isAccountingOnlyBlockedPath(pathname: string): boolean {
    return RETAIL_PATH_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}