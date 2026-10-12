'use client';

import { useMemo } from 'react';
import { useMe } from '@/hooks/use-me';
import { extractTenantPlan } from './nav-visibility';
import { getWorkspaceItem } from './session-store';

type TenantPlanState = {
  planCode: string | null;
  features: Record<string, unknown>;
  /** `Tenant.dashboard_preference` — AUTO defers to the plan. */
  dashboardPreference: string;
  /** Store permissions the user holds in this tenant, unioned across stores. */
  permissions: string[];
  /**
   * The user's role in this tenant. Needed alongside `permissions` because an
   * OWNER bypasses `StorePermissionGuard` server-side and so may hold no
   * explicit grant rows at all — checking permissions alone would hide
   * capabilities from the one user who definitely has them.
   */
  role: string | null;
  ready: boolean;
};

const EMPTY: TenantPlanState = {
  planCode: null,
  features: {},
  dashboardPreference: 'AUTO',
  permissions: [],
  role: null,
  ready: true,
};

const PENDING: TenantPlanState = { ...EMPTY, ready: false };

/**
 * The workspace's plan and this member's grants, read off the shared `/auth/me`
 * cache. Sixteen screens use this; each used to fetch `/auth/me` for itself on
 * mount, and now they are ready on the first render whenever the shell already
 * holds the answer.
 */
export function useTenantPlanFeatures(): TenantPlanState {
  const { data: me, isError } = useMe();
  const tenantId = getWorkspaceItem('tenant_id');

  return useMemo(() => {
    if (me !== undefined) return { ...extractTenantPlan(me, tenantId), ready: true };
    // Nothing to read the plan from: degrade to the free set, as before.
    return isError ? EMPTY : PENDING;
  }, [me, isError, tenantId]);
}
