'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
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

export function useTenantPlanFeatures() {
  const [state, setState] = useState<TenantPlanState>({ ...EMPTY, ready: false });

  useEffect(() => {
    let active = true;
    api.getMe()
      .then((me) => {
        if (!active) return;
        const tenantId = getWorkspaceItem('tenant_id');
        setState({ ...extractTenantPlan(me, tenantId), ready: true });
      })
      .catch(() => {
        if (active) setState(EMPTY);
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
