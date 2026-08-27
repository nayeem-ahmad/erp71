import { api } from './api';
import { syncLocalePreferenceFromSession } from './localization/preference';
import { routes } from './routes';
import { clearStoredSession } from './session-expiry';
import {
    clearLastTenantId,
    clearWorkspace,
    getWorkspaceItem,
    removeWorkspaceItem,
    setCredentials,
    setLastTenantId,
    setWorkspaceItem,
} from './session-store';

/**
 * A "login context" is one of the workspaces a signed-in identity can act as:
 *  - the Platform Admin console (only when the user is a platform admin), or
 *  - the Referral Partner portal (when the user is a linked referee), or
 *  - the Employee self-service portal (when the user is a linked employee), or
 *  - a specific shop/tenant the user belongs to.
 *
 * When more than one context is available we ask the user to choose which one
 * they want to log into instead of silently defaulting to the first.
 */
export type LoginContexts = {
    isPlatformAdmin: boolean;
    isReferee: boolean;
    isEmployee: boolean;
    tenants: any[];
    /** Total selectable contexts (admin console + portals + each shop). */
    count: number;
};

export function getLoginContexts(me: any): LoginContexts {
    const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
    const isPlatformAdmin = Boolean(me?.is_platform_admin);
    const isReferee = Boolean(me?.referee?.is_active);
    const isEmployee = Boolean(me?.employee?.id);
    return {
        isPlatformAdmin,
        isReferee,
        isEmployee,
        tenants,
        count: (isPlatformAdmin ? 1 : 0) + (isReferee ? 1 : 0) + (isEmployee ? 1 : 0) + tenants.length,
    };
}

/** Activate the referee self-service portal (no shop/tenant scope). */
export function applyRefereeContext() {
    rememberCurrentTenant();
    setWorkspaceItem('active_context', 'referee');
    removeWorkspaceItem('tenant_id');
    removeWorkspaceItem('store_id');
    removeWorkspaceItem('subscription_plan_code');
}

/**
 * Activate the employee self-service portal.
 *
 * Unlike the referee and platform-admin contexts this **keeps** the tenant
 * scope: an employee is a real member of their shop, and every portal endpoint
 * resolves that tenant from their own employee row anyway. Clearing it would
 * only break the app shell, which needs a tenant to render.
 */
export function applyEmployeeContext(employee: { tenant_id?: string | null }) {
    setWorkspaceItem('active_context', 'employee');
    if (employee?.tenant_id) {
        setWorkspaceItem('tenant_id', employee.tenant_id);
        setLastTenantId(employee.tenant_id);
    }
    removeWorkspaceItem('store_id');
}

/** Activate the Platform Admin console (no shop/tenant scope). */
export function applyPlatformAdminContext() {
    rememberCurrentTenant();
    setWorkspaceItem('active_context', 'platform-admin');
    removeWorkspaceItem('tenant_id');
    removeWorkspaceItem('store_id');
    removeWorkspaceItem('subscription_plan_code');
}

/**
 * Activate a specific shop/tenant as the current workspace.
 *
 * Scoped to this tab. `last_tenant_id` is the one part that is shared, because
 * it is what a brand-new tab resumes from.
 */
export function applyTenantContext(tenant: any) {
    removeWorkspaceItem('active_context');
    setWorkspaceItem('tenant_id', tenant.id);
    setLastTenantId(tenant.id);
    if (tenant.stores && tenant.stores.length > 0) {
        setWorkspaceItem('store_id', tenant.stores[0].id);
    } else {
        removeWorkspaceItem('store_id');
    }
    if (tenant.subscription?.plan?.code) {
        setWorkspaceItem('subscription_plan_code', tenant.subscription.plan.code);
    } else {
        removeWorkspaceItem('subscription_plan_code');
    }
}

/** Forget the selected workspace so the account chooser starts clean. */
export function clearActiveContext() {
    clearWorkspace();
    clearLastTenantId();
}

/**
 * Park the shop this tab is in before leaving it for a portal, so coming back
 * lands on the same one.
 */
function rememberCurrentTenant() {
    const currentTenantId = getWorkspaceItem('tenant_id');
    if (currentTenantId) setLastTenantId(currentTenantId);
}

export type StoreAuthResult = { redirectTo: string };

/** Remove a key from both backends, whichever one it happens to sit in. */
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
    setCredentials(data, rememberMe);
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
        return { redirectTo: routes.referralsPortal.root };
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
    // Shares one key list with the expired-session path so an explicit sign-out
    // and an expiry can never clear different things.
    clearStoredSession();
}

/** True when the path belongs to a shop workspace (not the platform admin console). */
export function isShopWorkspacePath(pathname: string) {
    if (pathname.startsWith(routes.admin.root)) return false;
    if (pathname.startsWith(routes.referralsPortal.root)) return false;
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