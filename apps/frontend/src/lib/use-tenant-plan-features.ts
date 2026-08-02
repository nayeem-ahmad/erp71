'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { extractTenantPlan } from './nav-visibility';

type TenantPlanState = {
  planCode: string | null;
  features: Record<string, unknown>;
  /** `Tenant.dashboard_preference` — AUTO defers to the plan. */
  dashboardPreference: string;
  /** Store permissions the user holds in this tenant, unioned across stores. */
  permissions: string[];
  ready: boolean;
};

const EMPTY: TenantPlanState = {
  planCode: null,
  features: {},
  dashboardPreference: 'AUTO',
  permissions: [],
  ready: true,
};

export function useTenantPlanFeatures() {
  const [state, setState] = useState<TenantPlanState>({ ...EMPTY, ready: false });

  useEffect(() => {
    let active = true;
    api.getMe()
      .then((me) => {
        if (!active) return;
        const tenantId = localStorage.getItem('tenant_id');
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
