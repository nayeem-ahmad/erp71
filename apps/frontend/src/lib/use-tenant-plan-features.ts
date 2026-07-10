'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { extractTenantPlan } from './nav-visibility';

export function useTenantPlanFeatures() {
  const [state, setState] = useState<{
    planCode: string | null;
    features: Record<string, unknown>;
    ready: boolean;
  }>({ planCode: null, features: {}, ready: false });

  useEffect(() => {
    let active = true;
    api.getMe()
      .then((me) => {
        if (!active) return;
        const tenantId = localStorage.getItem('tenant_id');
        const { planCode, features } = extractTenantPlan(me, tenantId);
        setState({ planCode, features, ready: true });
      })
      .catch(() => {
        if (active) setState({ planCode: null, features: {}, ready: true });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
