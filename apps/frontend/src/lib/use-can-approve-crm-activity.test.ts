import { act, renderHook, waitFor } from '@testing-library/react';
import { useCanApproveCrmActivity } from './use-can-approve-crm-activity';

jest.mock('@/lib/api', () => ({
    api: { getMe: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

/**
 * Settles the `/auth/me` call the hook made. The answer starts out `false`, so
 * without this a "no" could not be told apart from "not answered yet".
 */
const settleMe = () =>
    act(async () => {
        await api.getMe.mock.results[0].value;
    });

describe('useCanApproveCrmActivity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.sessionStorage.clear();
        window.localStorage.clear();
    });

    it('lets a member holding APPROVE_CRM_ACTIVITY approve', async () => {
        api.getMe.mockResolvedValue({
            id: 'user-1',
            tenants: [{ id: 'tenant-1', role: 'MANAGER', permissions: ['APPROVE_CRM_ACTIVITY'] }],
        });

        const { result } = renderHook(() => useCanApproveCrmActivity());

        await waitFor(() => expect(result.current).toBe(true));
    });

    // The owner's row lists no permissions: owning the workspace grants them all.
    it('lets the workspace owner approve', async () => {
        api.getMe.mockResolvedValue({
            id: 'user-1',
            tenants: [{ id: 'tenant-1', role: 'OWNER', permissions: [] }],
        });

        const { result } = renderHook(() => useCanApproveCrmActivity());

        await waitFor(() => expect(result.current).toBe(true));
    });

    // Writing plans is not signing them off — that split is the point of the
    // separate permission.
    it('refuses a member who can manage CRM tasks but not approve them', async () => {
        api.getMe.mockResolvedValue({
            id: 'user-1',
            tenants: [{ id: 'tenant-1', role: 'STAFF', permissions: ['MANAGE_CRM_TASKS'] }],
        });

        const { result } = renderHook(() => useCanApproveCrmActivity());
        await settleMe();

        expect(result.current).toBe(false);
    });

    // One account can approve in one shop and not in another, so the answer comes
    // from the workspace this tab is in, not whichever the payload lists first.
    it('reads the permission off the workspace this tab is in', async () => {
        window.sessionStorage.setItem('tenant_id', 'tenant-2');
        api.getMe.mockResolvedValue({
            id: 'user-1',
            tenants: [
                { id: 'tenant-1', role: 'STAFF', permissions: [] },
                { id: 'tenant-2', role: 'MANAGER', permissions: ['APPROVE_CRM_ACTIVITY'] },
            ],
        });

        const { result } = renderHook(() => useCanApproveCrmActivity());

        await waitFor(() => expect(result.current).toBe(true));
    });
});
