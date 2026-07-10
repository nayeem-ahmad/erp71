import { renderHook, waitFor } from '@testing-library/react';
import { useTenantPlanFeatures } from './use-tenant-plan-features';
import { api } from './api';

jest.mock('./api', () => ({ api: { getMe: jest.fn() } }));

describe('useTenantPlanFeatures', () => {
  beforeEach(() => {
    localStorage.setItem('tenant_id', 't1');
    (api.getMe as jest.Mock).mockResolvedValue({
      tenants: [{ id: 't1', subscription: { plan: { code: 'BASIC', features_json: { premiumCrm: false } } } }],
    });
  });

  it('resolves the current tenant plan features and flips ready', async () => {
    const { result } = renderHook(() => useTenantPlanFeatures());
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.planCode).toBe('BASIC');
    expect(result.current.features).toEqual({ premiumCrm: false });
  });

  it('degrades to empty features when getMe rejects', async () => {
    (api.getMe as jest.Mock).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useTenantPlanFeatures());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.features).toEqual({});
  });
});
