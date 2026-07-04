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
    const currentTenantId = localStorage.getItem('tenant_id');
    if (currentTenantId) {
        localStorage.setItem('last_tenant_id', currentTenantId);
    }
    localStorage.setItem('active_context', 'referee');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('store_id');
    localStorage.removeItem('subscription_plan_code');
}

/** Activate the Platform Admin console (no shop/tenant scope). */
export function applyPlatformAdminContext() {
    const currentTenantId = localStorage.getItem('tenant_id');
    if (currentTenantId) {
        localStorage.setItem('last_tenant_id', currentTenantId);
    }
    localStorage.setItem('active_context', 'platform-admin');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('store_id');
    localStorage.removeItem('subscription_plan_code');
}

/** Activate a specific shop/tenant as the current workspace. */
export function applyTenantContext(tenant: any) {
    localStorage.removeItem('active_context');
    localStorage.setItem('tenant_id', tenant.id);
    localStorage.setItem('last_tenant_id', tenant.id);
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
    localStorage.removeItem('last_tenant_id');
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
    localStorage.removeItem('access_token');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('last_tenant_id');
    localStorage.removeItem('store_id');
    localStorage.removeItem('subscription_plan_code');
    localStorage.removeItem('demo_session');
    localStorage.removeItem('onboarding_complete');
    localStorage.removeItem('active_context');
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
