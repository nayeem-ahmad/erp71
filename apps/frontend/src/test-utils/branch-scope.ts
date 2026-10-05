import { useCallback, useState } from 'react';
import type { BranchScopeState, UseBranchScope } from '@/lib/branch-scope';

/**
 * A stand-in for `useBranchScope` in page tests, so a page test does not have
 * to fake `/auth/me`, the workspace store and the router just to get a branch.
 *
 *     jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());
 *     beforeEach(() => mockBranchScope());              // two branches, header = store-1
 *     mockBranchScope({ value: 'all' });               // start on "All branches"
 *
 * The filter keeps its own state, so changing the rendered `BranchFilter`
 * (label "Branch") re-renders the page with the new `apiStoreId`, as the real
 * `?branch=` round trip would.
 */

export const MOCK_BRANCHES = [
    { id: 'store-1', name: 'Dhaka Branch' },
    { id: 'store-2', name: 'Chattogram Branch' },
];

type Overrides = Partial<BranchScopeState>;

let overrides: Overrides = {};

/** Every `resetToHeader` the pages call, e.g. after a 403. */
export const resetToHeaderSpy = jest.fn();

export function mockBranchScope(next: Overrides = {}) {
    overrides = next;
    resetToHeaderSpy.mockClear();
}

export function useMockBranchScope(opts: { allowAll?: boolean } = {}): UseBranchScope {
    const base: BranchScopeState = {
        branches: MOCK_BRANCHES,
        headerBranchId: 'store-1',
        value: 'store-1',
        canSeeAll: opts.allowAll !== false,
        locked: false,
        hidden: false,
        apiStoreId: undefined,
        ready: true,
        ...overrides,
    };
    const [value, setValueState] = useState(base.value);
    const setValue = useCallback(
        (next: string) => setValueState(next || base.headerBranchId || ''),
        [base.headerBranchId],
    );
    const resetToHeader = useCallback(() => {
        resetToHeaderSpy();
        setValueState(base.headerBranchId || '');
    }, [base.headerBranchId]);

    return {
        ...base,
        value,
        apiStoreId: base.ready ? value || undefined : undefined,
        setValue,
        resetToHeader,
    };
}

/** The `jest.mock('@/lib/branch-scope', …)` factory: the real module, with the hook swapped. */
export function branchScopeModuleMock() {
    return {
        ...jest.requireActual('@/lib/branch-scope'),
        useBranchScope: useMockBranchScope,
    };
}
