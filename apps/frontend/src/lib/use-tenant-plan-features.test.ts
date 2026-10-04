import { waitFor } from '@testing-library/react';
import { renderHookWithQueryClient } from '@/test-utils/query-client';
import { seedMe } from '@/hooks/use-me';
import { useTenantPlanFeatures } from './use-tenant-plan-features';
import { api } from './api';
import { setWorkspaceItem } from './session-store';

jest.mock('./api', () => ({ api: { getMe: jest.fn() } }));

describe('useTenantPlanFeatures', () => {
  beforeEach(() => {
    setWorkspaceItem('tenant_id', 't1');
    (api.getMe as jest.Mock).mockResolvedValue({
      tenants: [{ id: 't1', subscription: { plan: { code: 'BASIC', features_json: { premiumCrm: false } } } }],
    });
  });

  it('resolves the current tenant plan features and flips ready', async () => {
    const { result } = renderHookWithQueryClient(() => useTenantPlanFeatures());
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.planCode).toBe('BASIC');
    expect(result.current.features).toEqual({ premiumCrm: false });
  });

  it('degrades to empty features when getMe rejects', async () => {
    (api.getMe as jest.Mock).mockRejectedValue(new Error('nope'));
    const { result } = renderHookWithQueryClient(() => useTenantPlanFeatures());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.features).toEqual({});
  });

  it('is ready on the first render when the shell already holds /auth/me', () => {
    (api.getMe as jest.Mock).mockClear();
    seedMe({
      tenants: [{ id: 't1', subscription: { plan: { code: 'PREMIUM', features_json: { premiumCrm: true } } } }],
    });

    const { result } = renderHookWithQueryClient(() => useTenantPlanFeatures());

    expect(result.current.ready).toBe(true);
    expect(result.current.planCode).toBe('PREMIUM');
    expect(api.getMe).not.toHaveBeenCalled();
  });
});
