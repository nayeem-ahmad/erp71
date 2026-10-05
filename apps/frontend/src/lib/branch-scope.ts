'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMe } from '@/hooks/use-me';
import { hasPermission, isOwner, tenantFromMe } from '@/lib/permissions';
import { getWorkspaceItem } from '@/lib/session-store';

/**
 * The page-level branch filter. Spec:
 * `docs/superpowers/specs/2026-10-05-branch-filter-design.md`.
 *
 * - The filter **starts on the header branch** (`store_id`, what every request
 *   carries as `x-store-id`). A change is page-local and lives in the URL as
 *   `?branch=`, so a reload or a shared link keeps it; the app shell drops the
 *   param when the header branch changes, so every page follows the header.
 * - It offers the branches the member may use, plus **“All branches”** for
 *   owners and `VIEW_CONSOLIDATED_REPORTS` holders.
 * - It is **disabled** for a member limited to one branch of several, and
 *   **hidden** in a one-branch shop, where there is nothing to choose.
 *
 * The server applies the same rules (`BranchScopeService`), so this is about
 * not offering what would be refused, not about security.
 */

/** The `storeId` value that asks the API for every branch. */
export const ALL_BRANCHES = 'all';

/** The page's own URL param. */
export const BRANCH_PARAM = 'branch';

/** Older deep links (line-item reports) used `?storeId=`; read as an alias. */
const LEGACY_BRANCH_PARAM = 'storeId';

export type BranchOption = { id: string; name: string };

export type BranchScopeState = {
    /** The branches the member may use. */
    branches: BranchOption[];
    /** The header's branch — what the filter starts on. */
    headerBranchId: string | null;
    /** A branch id, or `ALL_BRANCHES`; `''` only while `/auth/me` is loading. */
    value: string;
    /** Owner or `VIEW_CONSOLIDATED_REPORTS`, and the page allows it. */
    canSeeAll: boolean;
    /** Limited to one branch of a multi-branch shop: show it, disabled. */
    locked: boolean;
    /** A one-branch shop (or no branch at all): render nothing. */
    hidden: boolean;
    /**
     * What to send as the API's `storeId`, and to put in the query key so a
     * change is a fresh query rather than a cache hit. `undefined` while
     * loading — gate the fetch on `ready`.
     */
    apiStoreId: string | undefined;
    /** `/auth/me` is in, so `value` is final. */
    ready: boolean;
};

export function canViewConsolidatedReports(role: string | null | undefined, permissions?: string[]) {
    return isOwner(role) || hasPermission(permissions, 'VIEW_CONSOLIDATED_REPORTS');
}

type TenantRow = {
    id: string;
    role?: string | null;
    permissions?: string[];
    stores?: BranchOption[];
    store_count?: number;
};

/** The pure half of `useBranchScope`, for tests and non-hook callers. */
export function resolveBranchScope(input: {
    tenant: TenantRow | undefined;
    headerBranchId: string | null;
    requested: string | null;
    allowAll?: boolean;
}): BranchScopeState {
    const { tenant, headerBranchId, requested } = input;
    const allowAll = input.allowAll !== false;

    if (!tenant) {
        return {
            branches: [],
            headerBranchId,
            value: '',
            canSeeAll: false,
            locked: false,
            hidden: true,
            apiStoreId: undefined,
            ready: false,
        };
    }

    const branches = (tenant.stores ?? []).map((store) => ({ id: store.id, name: store.name }));
    const storeCount = tenant.store_count ?? branches.length;
    const canSeeAll = allowAll && canViewConsolidatedReports(tenant.role, tenant.permissions);
    const isBranch = (id: string | null | undefined): id is string =>
        Boolean(id) && branches.some((branch) => branch.id === id);

    const fallback = isBranch(headerBranchId) ? headerBranchId : branches[0]?.id ?? '';
    let value = fallback;
    if (requested === ALL_BRANCHES) {
        if (canSeeAll) value = ALL_BRANCHES;
    } else if (isBranch(requested)) {
        value = requested;
    }

    return {
        branches,
        headerBranchId: isBranch(headerBranchId) ? headerBranchId : fallback || null,
        value,
        canSeeAll,
        locked: storeCount > 1 && branches.length === 1 && !canSeeAll,
        hidden: storeCount <= 1 || branches.length === 0,
        apiStoreId: value || undefined,
        ready: true,
    };
}

export type UseBranchScope = BranchScopeState & {
    /** Pick a branch (or `ALL_BRANCHES`) for this page. */
    setValue: (next: string) => void;
    /** Back to the header branch — e.g. after the server refused the choice. */
    resetToHeader: () => void;
};

export function useBranchScope(opts: { allowAll?: boolean } = {}): UseBranchScope {
    const { data: me } = useMe();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const tenant = tenantFromMe<TenantRow>(me, getWorkspaceItem('tenant_id'));
    const headerBranchId = getWorkspaceItem('store_id');
    const requested = searchParams?.get(BRANCH_PARAM) ?? searchParams?.get(LEGACY_BRANCH_PARAM) ?? null;

    const state = useMemo(
        () => resolveBranchScope({ tenant, headerBranchId, requested, allowAll: opts.allowAll }),
        [tenant, headerBranchId, requested, opts.allowAll],
    );

    const setValue = useCallback(
        (next: string) => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.delete(LEGACY_BRANCH_PARAM);
            if (!next || next === state.headerBranchId) {
                params.delete(BRANCH_PARAM);
            } else {
                params.set(BRANCH_PARAM, next);
            }
            const query = params.toString();
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        },
        [pathname, router, searchParams, state.headerBranchId],
    );

    const resetToHeader = useCallback(() => setValue(''), [setValue]);

    return { ...state, setValue, resetToHeader };
}

/**
 * Drop this page's own branch choice from a URL — the app shell calls it when
 * the header branch changes, so the page snaps to the new header branch.
 * Returns `null` when there was nothing to drop.
 */
export function stripBranchParam(url: string): string | null {
    const [path, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    if (!params.has(BRANCH_PARAM) && !params.has(LEGACY_BRANCH_PARAM)) return null;
    params.delete(BRANCH_PARAM);
    params.delete(LEGACY_BRANCH_PARAM);
    const rest = params.toString();
    return rest ? `${path}?${rest}` : path;
}

/** Whether an API error is the server refusing the branch the page asked for. */
export function isBranchForbidden(error: unknown): boolean {
    const status = (error as { status?: number; response?: { status?: number } } | null)?.status
        ?? (error as { response?: { status?: number } } | null)?.response?.status;
    return status === 403;
}
