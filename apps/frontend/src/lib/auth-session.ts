import { api } from './api';
import { syncLocalePreferenceFromSession } from './localization/preference';
import { routes } from './routes';

/**
 * A "login context" is one of the workspaces a signed-in identity can act as:
 *  - the Platform Admin console (only when the user is a platform admin), or
 *  - the Referral Partner portal (when the user is a linked referee), or
 *  - a specific shop/tenant the user belongs to.
 *
 * When more than one context is available we ask the user to choose which one
 * they want to log into instead of silently defaulting to the first.
 */
export type LoginContexts = {
    isPlatformAdmin: boolean;
    isReferee: boolean;
    tenants: any[];
    /** Total selectable contexts (admin console + referee portal + each shop). */
    count: number;
};

export function getLoginContexts(me: any): LoginContexts {
    const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
    const isPlatformAdmin = Boolean(me?.is_platform_admin);
    const isReferee = Boolean(me?.referee?.is_active);
    return {
        isPlatformAdmin,
        isReferee,
        tenants,
        count: (isPlatformAdmin ? 1 : 0) + (isReferee ? 1 : 0) + tenants.length,
    };
}

/** Activate the referee self-service portal (no shop/tenant scope). */
export function applyRefereeContext() {
    const currentTenantId = getStorage('tenant_id');
    if (currentTenantId) {
        setStorage('last_tenant_id', currentTenantId);
    }
    setStorage('active_context', 'referee');
    removeStorage('tenant_id');
    removeStorage('store_id');
    removeStorage('subscription_plan_code');
}

/** Activate the Platform Admin console (no shop/tenant scope). */
export function applyPlatformAdminContext() {
    const currentTenantId = getStorage('tenant_id');
    if (currentTenantId) {
        setStorage('last_tenant_id', currentTenantId);
    }
    setStorage('active_context', 'platform-admin');
    removeStorage('tenant_id');
    removeStorage('store_id');
    removeStorage('subscription_plan_code');
}

/** Activate a specific shop/tenant as the current workspace. */
export function applyTenantContext(tenant: any) {
    removeStorage('active_context');
    setStorage('tenant_id', tenant.id);
    setStorage('last_tenant_id', tenant.id);
    if (tenant.stores && tenant.stores.length > 0) {
        setStorage('store_id', tenant.stores[0].id);
    } else {
        removeStorage('store_id');
    }
    if (tenant.subscription?.plan?.code) {
        setStorage('subscription_plan_code', tenant.subscription.plan.code);
    } else {
        removeStorage('subscription_plan_code');
    }
}

/** Forget the selected workspace so the account chooser starts clean. */
export function clearActiveContext() {
    removeStorage('active_context');
    removeStorage('tenant_id');
    removeStorage('last_tenant_id');
    removeStorage('store_id');
    removeStorage('subscription_plan_code');
}

export type StoreAuthResult = { redirectTo: string };

/**
 * Helper: get an item from localStorage, falling back to sessionStorage.
 * Used for reading token and other session-scoped values.
 */
function getStorage(key: string): string | null {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

/**
 * Helper: set a value in the correct storage depending on whether "Remember Me"
 * was checked. When `rememberMe` is true, use localStorage (persists across
 * browser closes). When false, use sessionStorage (cleared when tab closes).
 * For keys that are always contextual (tenant_id, store_id, etc.) we always
 * write to localStorage since those are not secrets.
 */
const ALWAYS_LOCAL_KEYS = new Set([
    'tenant_id', 'last_tenant_id', 'store_id', 'subscription_plan_code',
    'active_context', 'demo_session', 'onboarding_complete', 'locale',
    'demo_banner_dismissed', 'last_tenant_id',
]);

function setStorage(key: string, value: string, rememberMe?: boolean): void {
    if (ALWAYS_LOCAL_KEYS.has(key) || rememberMe) {
        localStorage.setItem(key, value);
    } else {
        sessionStorage.setItem(key, value);
    }
}

function removeStorage(key: string): void {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
}

/**
 * Sidebar rail/menu open-state persisted for a returning session. Cleared on
 * login so every login starts with a fully-collapsed sidebar at default width.
 */
export function clearSidebarLayoutState(): void {
    removeStorage('sidebar-open-groups');
    removeStorage('sidebar-collapsed');
    removeStorage('sidebar-width');
}

export async function storeAuthResponse(res: any, rememberMe = false): Promise<StoreAuthResult> {
    const data = res.data ? res.data : res;
    setStorage('access_token', data.access_token, rememberMe);
    // Fresh login → start from a collapsed, default-width sidebar.
    clearSidebarLayoutState();

    if (data.is_demo) {
        localStorage.setItem('demo_session', '1');
    } else {
        localStorage.removeItem('demo_session');
    }

    // Always load the full session profile — login payload omits referee context.
    const meRes = await api.getMe();
    syncLocalePreferenceFromSession(meRes, { overwrite: true });

    if (meRes.is_demo) {
        localStorage.setItem('demo_session', '1');
    }

    const { isPlatformAdmin, isReferee, tenants, count } = getLoginContexts(meRes);

    // More than one workspace available → let the user choose which to enter.
    if (count > 1) {
        clearActiveContext();
        return { redirectTo: '/select-account' };
    }

    // Exactly one shop → enter it directly.
    if (tenants.length === 1) {
        applyTenantContext(tenants[0]);
        return { redirectTo: routes.home };
    }

    // Referee with no shop of their own → referral portal.
    if (isReferee) {
        applyRefereeContext();
        return { redirectTo: routes.referralsPortal };
    }

    // Platform admin with no shop of their own → straight to the admin console.
    if (isPlatformAdmin) {
        applyPlatformAdminContext();
        return { redirectTo: routes.admin.root };
    }

    // No workspace yet (brand-new account) → dashboard handles onboarding.
    clearActiveContext();
    return { redirectTo: routes.home };
}

export function clearAuthSession() {
    // Clear both storage backends to ensure full logout.
    const keys = [
        'access_token',
        'tenant_id',
        'last_tenant_id',
        'store_id',
        'subscription_plan_code',
        'demo_session',
        'onboarding_complete',
        'active_context',
    ];
    for (const key of keys) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }
}

/** True when the path belongs to a shop workspace (not the platform admin console). */
export function isShopWorkspacePath(pathname: string) {
    if (pathname.startsWith(routes.admin.root)) return false;
    if (pathname.startsWith(routes.referralsPortal)) return false;
    const shopPrefixes = [
        routes.home,
        routes.onboarding,
        '/sales',
        '/purchases',
        '/accounting',
        '/inventory',
        '/storefront',
        '/hr',
        '/settings',
        '/billing',
        '/team',
        '/sms-credits',
        '/ai-credits',
        '/support',
    ];
    return shopPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}