import { ALL_BRANCHES, isBranchForbidden, resolveBranchScope, stripBranchParam } from './branch-scope';

const A = { id: 'A', name: 'Dhanmondi' };
const B = { id: 'B', name: 'Mirpur' };

const tenant = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    role: 'CASHIER',
    permissions: ['CREATE_SALE'],
    stores: [A, B],
    store_count: 2,
    ...overrides,
});

describe('resolveBranchScope', () => {
    it('is not ready, and draws nothing, until /auth/me is in', () => {
        const state = resolveBranchScope({ tenant: undefined, headerBranchId: 'A', requested: null });
        expect(state.ready).toBe(false);
        expect(state.hidden).toBe(true);
        expect(state.apiStoreId).toBeUndefined();
    });

    it('starts on the header branch', () => {
        const state = resolveBranchScope({ tenant: tenant(), headerBranchId: 'B', requested: null });
        expect(state.value).toBe('B');
        expect(state.apiStoreId).toBe('B');
        expect(state.ready).toBe(true);
    });

    it('takes a URL branch the member may use', () => {
        expect(resolveBranchScope({ tenant: tenant(), headerBranchId: 'A', requested: 'B' }).value).toBe('B');
    });

    it('falls back to the header branch for a branch the member cannot use', () => {
        expect(resolveBranchScope({ tenant: tenant(), headerBranchId: 'A', requested: 'Z' }).value).toBe('A');
    });

    it('offers and honours "all" only with consolidated access', () => {
        const plain = resolveBranchScope({ tenant: tenant(), headerBranchId: 'A', requested: ALL_BRANCHES });
        expect(plain.canSeeAll).toBe(false);
        expect(plain.value).toBe('A');

        const consolidated = resolveBranchScope({
            tenant: tenant({ permissions: ['VIEW_CONSOLIDATED_REPORTS'] }),
            headerBranchId: 'A',
            requested: ALL_BRANCHES,
        });
        expect(consolidated.canSeeAll).toBe(true);
        expect(consolidated.value).toBe(ALL_BRANCHES);
        expect(consolidated.apiStoreId).toBe(ALL_BRANCHES);

        const owner = resolveBranchScope({ tenant: tenant({ role: 'OWNER', permissions: [] }), headerBranchId: 'A', requested: null });
        expect(owner.canSeeAll).toBe(true);
        expect(owner.value).toBe('A');
    });

    // Company-level lists (customers) start where they were before the filter.
    it('starts on "all" with startOnAll, for a member who may see it', () => {
        const owner = resolveBranchScope({
            tenant: tenant({ role: 'OWNER', permissions: [] }),
            headerBranchId: 'A',
            requested: null,
            startOnAll: true,
        });
        expect(owner.value).toBe(ALL_BRANCHES);
        expect(owner.defaultValue).toBe(ALL_BRANCHES);
        expect(owner.apiStoreId).toBe(ALL_BRANCHES);

        const picked = resolveBranchScope({
            tenant: tenant({ role: 'OWNER', permissions: [] }),
            headerBranchId: 'A',
            requested: 'A',
            startOnAll: true,
        });
        expect(picked.value).toBe('A');
    });

    it('still starts a limited member on the header branch with startOnAll', () => {
        const state = resolveBranchScope({ tenant: tenant(), headerBranchId: 'B', requested: null, startOnAll: true });
        expect(state.canSeeAll).toBe(false);
        expect(state.value).toBe('B');
        expect(state.defaultValue).toBe('B');
    });

    it('never offers "all" on a one-branch page', () => {
        const state = resolveBranchScope({
            tenant: tenant({ role: 'OWNER' }),
            headerBranchId: 'A',
            requested: ALL_BRANCHES,
            allowAll: false,
        });
        expect(state.canSeeAll).toBe(false);
        expect(state.value).toBe('A');
    });

    it('locks a member limited to one branch of several', () => {
        const state = resolveBranchScope({
            tenant: tenant({ stores: [A], store_count: 3 }),
            headerBranchId: 'A',
            requested: 'B',
        });
        expect(state.locked).toBe(true);
        expect(state.hidden).toBe(false);
        expect(state.value).toBe('A');
    });

    it('does not lock a one-branch member who may see the whole company', () => {
        const state = resolveBranchScope({
            tenant: tenant({ stores: [A], store_count: 3, permissions: ['VIEW_CONSOLIDATED_REPORTS'] }),
            headerBranchId: 'A',
            requested: null,
        });
        expect(state.locked).toBe(false);
    });

    it('hides the filter in a one-branch shop', () => {
        const state = resolveBranchScope({
            tenant: tenant({ role: 'OWNER', stores: [A], store_count: 1 }),
            headerBranchId: 'A',
            requested: null,
        });
        expect(state.hidden).toBe(true);
        expect(state.apiStoreId).toBe('A');
    });

    it('falls back to the first branch when the header names none of them', () => {
        expect(resolveBranchScope({ tenant: tenant(), headerBranchId: null, requested: null }).value).toBe('A');
    });
});

describe('stripBranchParam', () => {
    it('drops ?branch= and the legacy ?storeId=, keeping the rest', () => {
        expect(stripBranchParam('/sales/list?branch=B&page=2')).toBe('/sales/list?page=2');
        expect(stripBranchParam('/sales/reports/line-items?storeId=B')).toBe('/sales/reports/line-items');
    });

    it('returns null when there is nothing to drop', () => {
        expect(stripBranchParam('/sales/list?page=2')).toBeNull();
    });
});

describe('isBranchForbidden', () => {
    it('recognises a 403', () => {
        expect(isBranchForbidden({ status: 403 })).toBe(true);
        expect(isBranchForbidden({ status: 500 })).toBe(false);
        expect(isBranchForbidden(null)).toBe(false);
    });
});
