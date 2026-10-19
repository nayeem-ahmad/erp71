import { renderHook } from '@testing-library/react';
import { useBranchScope } from './branch-scope';
import { printBranch } from './print/print-branch';
import { setWorkspaceItem } from './session-store';

/*
 * The hook publishes the page's branch for the prints that cannot be handed it
 * (a list's Print button), so they print that branch's letterhead.
 */

const mockSearch = { current: new URLSearchParams() };

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn() }),
    usePathname: () => '/sales/list',
    useSearchParams: () => mockSearch.current,
}));

jest.mock('@/hooks/use-me', () => ({
    useMe: () => ({
        data: {
            tenants: [{
                id: 't1',
                role: 'OWNER',
                permissions: [],
                stores: [{ id: 'A', name: 'Dhanmondi' }, { id: 'B', name: 'Mirpur' }],
                store_count: 2,
            }],
        },
    }),
}));

describe('useBranchScope — print branch', () => {
    beforeEach(() => {
        setWorkspaceItem('tenant_id', 't1');
        setWorkspaceItem('store_id', 'A');
        mockSearch.current = new URLSearchParams();
    });

    it('publishes the header branch the page opens on', () => {
        renderHook(() => useBranchScope());

        expect(printBranch()).toBe('A');
    });

    it('publishes the branch picked on the page', () => {
        mockSearch.current = new URLSearchParams('branch=B');

        renderHook(() => useBranchScope());

        expect(printBranch()).toBe('B');
    });

    it('publishes nothing under "All branches", so the print is on company paper', () => {
        mockSearch.current = new URLSearchParams('branch=all');

        renderHook(() => useBranchScope());

        expect(printBranch()).toBeUndefined();
    });

    it('withdraws the branch when the page goes away', () => {
        const { unmount } = renderHook(() => useBranchScope());

        unmount();

        expect(printBranch()).toBeUndefined();
    });
});
