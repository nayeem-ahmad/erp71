import { api } from './api';
import { syncLocalePreferenceFromSession } from './localization/preference';

/**
 * A "login context" is one of the workspaces a signed-in identity can act as:
 *  - the Platform Admin console (only when the user is a platform admin), or
 *  - a specific shop/tenant the user belongs to.
 *
 * When more than one context is available we ask the user to choose which one
 * they want to log into instead of silently defaulting to the first.
 */
export type LoginContexts = {
    isPlatformAdmin: boolean;
    tenants: any[];
    /** Total selectable contexts (admin console + each shop). */
    count: number;
};

export function getLoginContexts(me: any): LoginContexts {
    const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
    const isPlatformAdmin = Boolean(me?.is_platform_admin);
    return {
        isPlatformAdmin,
        tenants,
        count: (isPlatformAdmin ? 1 : 0) + tenants.length,
    };
}

/** Activate the Platform Admin console (no shop/tenant scope). */
export function applyPlatformAdminContext() {
    localStorage.setItem('active_context', 'platform-admin');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('store_id');
    localStorage.removeItem('subscription_plan_code');
}

/** Activate a specific shop/tenant as the current workspace. */
export function applyTenantContext(tenant: any) {
    localStorage.removeItem('active_context');
    localStorage.setItem('tenant_id', tenant.id);
    if (tenant.stores && tenant.stores.length > 0) {
        localStorage.setItem('store_id', tenant.stores[0].id);
    } else {
        localStorage.removeItem('store_id');
    }
    if (tenant.subscription?.plan?.code) {
        localStorage.setItem('subscription_plan_code', tenant.subscription.plan.code);
    } else {
        localStorage.removeItem('subscription_plan_code');
    }
}

/** Forget the selected workspace so the account chooser starts clean. */
export function clearActiveContext() {
    localStorage.removeItem('active_context');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('store_id');
    localStorage.removeItem('subscription_plan_code');
}

export type StoreAuthResult = { redirectTo: string };

export async function storeAuthResponse(res: any): Promise<StoreAuthResult> {
    const data = res.data ? res.data : res;
    localStorage.setItem('access_token', data.access_token);

    if (data.is_demo) {
        localStorage.setItem('demo_session', '1');
    } else {
        localStorage.removeItem('demo_session');
    }

    const meRes = data.tenants ? data : await api.getMe();
    syncLocalePreferenceFromSession(meRes, { overwrite: true });

    if (meRes.is_demo) {
        localStorage.setItem('demo_session', '1');
    }

    const { isPlatformAdmin, tenants, count } = getLoginContexts(meRes);

    // More than one workspace available → let the user choose which to enter.
    if (count > 1) {
        clearActiveContext();
        return { redirectTo: '/select-account' };
    }

    // Exactly one shop → enter it directly.
    if (tenants.length === 1) {
        applyTenantContext(tenants[0]);
        return { redirectTo: '/dashboard' };
    }

    // Platform admin with no shop of their own → straight to the admin console.
    if (isPlatformAdmin) {
        applyPlatformAdminContext();
        return { redirectTo: '/dashboard/admin' };
    }

    // No workspace yet (brand-new account) → dashboard handles onboarding.
    clearActiveContext();
    return { redirectTo: '/dashboard' };
}

export function clearAuthSession() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('store_id');
    localStorage.removeItem('subscription_plan_code');
    localStorage.removeItem('demo_session');
    localStorage.removeItem('onboarding_complete');
    localStorage.removeItem('active_context');
}
