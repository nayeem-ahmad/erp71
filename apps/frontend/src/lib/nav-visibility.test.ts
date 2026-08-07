import { isItemVisible, extractTenantPlan } from './nav-visibility';

describe('isItemVisible', () => {
  it('shows items with no entitlement gate', () => {
    expect(isItemVisible({}, {})).toBe(true);
    expect(isItemVisible({ entitlement: undefined }, null)).toBe(true);
  });

  it('hides gated items when the entitlement is absent', () => {
    expect(isItemVisible({ entitlement: 'premiumCrm' }, {})).toBe(false);
  });

  it('shows gated items when the entitlement is present (boolean true)', () => {
    expect(isItemVisible({ entitlement: 'premiumCrm' }, { premiumCrm: true })).toBe(true);
  });

  it('shows gated items when the entitlement is a positive number', () => {
    expect(isItemVisible({ entitlement: 'aiCreditsMonthly' }, { aiCreditsMonthly: 500 })).toBe(true);
  });
});

describe('extractTenantPlan', () => {
  const me = {
    tenants: [
      { id: 't1', subscription: { plan: { code: 'BASIC', features_json: { premiumCrm: false } } } },
      {
        id: 't2',
        dashboard_preference: 'ACCOUNTING',
        permissions: ['VIEW_LEDGER'],
        role: 'MANAGER',
        subscription: { plan: { code: 'PREMIUM', features_json: { premiumCrm: true } } },
      },
    ],
  };
  it('selects the tenant matching tenantId', () => {
    expect(extractTenantPlan(me, 't2')).toEqual({
      planCode: 'PREMIUM',
      features: { premiumCrm: true },
      dashboardPreference: 'ACCOUNTING',
      permissions: ['VIEW_LEDGER'],
      role: 'MANAGER',
    });
  });
  it('falls back to the first tenant when tenantId is null/unknown', () => {
    expect(extractTenantPlan(me, null).planCode).toBe('BASIC');
  });
  it('defaults the dashboard preference, permissions and role when the tenant omits them', () => {
    expect(extractTenantPlan(me, 't1')).toEqual({
      planCode: 'BASIC',
      features: { premiumCrm: false },
      dashboardPreference: 'AUTO',
      permissions: [],
      role: null,
    });
  });
  it('returns empty features when me has no tenants', () => {
    expect(extractTenantPlan({}, 't1')).toEqual({
      planCode: null,
      features: {},
      dashboardPreference: 'AUTO',
      permissions: [],
      role: null,
    });
  });
});
