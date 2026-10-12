import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fetchMe } from '@/hooks/use-me';
import { getWorkspaceItem } from './session-store';
import { ALL_BRANCHES, canViewConsolidatedReports } from './branch-scope';

export type ReportScopeMode = 'branch' | 'company' | 'compare';

/**
 * Row granularity of a COA-grained report. Orthogonal to the scope: scope decides
 * which vouchers are counted, level decides how coarse the rows are.
 */
export type ReportLevelMode = 'account' | 'subgroup' | 'group';

export const REPORT_LEVEL_MODES: ReportLevelMode[] = ['account', 'subgroup', 'group'];

const REPORT_SCOPE_KEY = 'report_scope';
const REPORT_LEVEL_KEY = 'report_level';
const REPORT_HIDE_ZERO_KEY = 'report_hide_zero';
const REPORT_APPROVED_ONLY_KEY = 'report_approved_only';

/**
 * Whether rows with no balance are suppressed. Purely presentational — totals are
 * still the server's, so hiding a row never changes what a statement adds up to.
 */
export function getDefaultHideZero(): boolean {
    if (typeof window !== 'undefined') {
        return localStorage.getItem(REPORT_HIDE_ZERO_KEY) === 'true';
    }

    return false;
}

export function persistHideZero(hideZero: boolean) {
    if (typeof window !== 'undefined') {
        localStorage.setItem(REPORT_HIDE_ZERO_KEY, String(hideZero));
    }
}

export function getDefaultReportLevel(): ReportLevelMode {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(REPORT_LEVEL_KEY);
        if (saved === 'account' || saved === 'subgroup' || saved === 'group') {
            return saved;
        }
    }

    return 'account';
}

export function persistReportLevel(level: ReportLevelMode) {
    if (typeof window !== 'undefined') {
        localStorage.setItem(REPORT_LEVEL_KEY, level);
    }
}

/**
 * Per-request override of the tenant's `reports_approved_only` setting.
 *
 * Unlike scope/level/hideZero this is a SERVER filter, so the value is sent on
 * every report call rather than applied to the response. The tenant setting is
 * the starting point; once the user flips the toggle their choice is remembered
 * across report pages, and `undefined` (nothing saved) means "follow the
 * tenant setting" — which is also what the API does when the param is absent.
 */
export function getSavedApprovedOnly(): boolean | undefined {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(REPORT_APPROVED_ONLY_KEY);
        if (saved === 'true') return true;
        if (saved === 'false') return false;
    }

    return undefined;
}

export function persistApprovedOnly(approvedOnly: boolean) {
    if (typeof window !== 'undefined') {
        localStorage.setItem(REPORT_APPROVED_ONLY_KEY, String(approvedOnly));
    }
}

/**
 * Resolves the approved-only toggle for a report page: the tenant's setting,
 * overridden by whatever the user last chose. `ready` gates the first fetch so a
 * report is never generated against the wrong value and then silently corrected.
 */
export function useApprovedOnly() {
    const [approvedOnly, setApprovedOnlyState] = useState(false);
    const [approvalEnabled, setApprovalEnabled] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let active = true;

        api.getAccountingSettings()
            .then((settings) => {
                if (!active) return;
                setApprovalEnabled(Boolean(settings?.requireVoucherApproval));
                setApprovedOnlyState(getSavedApprovedOnly() ?? Boolean(settings?.reportsApprovedOnly));
            })
            .catch(() => {
                if (!active) return;
                setApprovedOnlyState(getSavedApprovedOnly() ?? false);
            })
            .finally(() => {
                if (active) setReady(true);
            });

        return () => {
            active = false;
        };
    }, []);

    const setApprovedOnly = (value: boolean) => {
        persistApprovedOnly(value);
        setApprovedOnlyState(value);
    };

    return { approvedOnly, setApprovedOnly, approvalEnabled, ready };
}

// Moved to `branch-scope.ts`, the page-level branch filter's home; kept
// exported here for the accounting pages that import it from this module.
export { canViewConsolidatedReports };

/**
 * Whether the statements open on "Compare branches" — remembered across the
 * P&L, balance sheet and trial balance. Branch vs company is no longer kept
 * here: the page's branch filter decides it, starting on the header branch.
 */
export function getDefaultCompare(canConsolidate: boolean): boolean {
    if (!canConsolidate || typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(REPORT_SCOPE_KEY) === 'compare';
    } catch {
        return false;
    }
}

export function persistCompare(compare: boolean) {
    if (typeof window === 'undefined') return;
    try {
        if (compare) localStorage.setItem(REPORT_SCOPE_KEY, 'compare');
        else localStorage.removeItem(REPORT_SCOPE_KEY);
    } catch {
        // Storage blocked (private window): the choice just isn't remembered.
    }
}

/**
 * The statement API's scope params: "Compare branches" overrides the filter;
 * otherwise "All branches" is the company and a branch is that branch.
 */
export function statementScopeParams(input: {
    compare: boolean;
    branchValue: string;
    selectedStoreIds: string[];
    includeCompanyBucket: boolean;
}): { scope: ReportScopeMode; storeId?: string; storeIds?: string[]; includeCompanyBucket?: boolean } {
    if (input.compare) {
        return { scope: 'compare', storeIds: input.selectedStoreIds, includeCompanyBucket: input.includeCompanyBucket };
    }
    if (input.branchValue === ALL_BRANCHES) {
        return { scope: 'company' };
    }
    return { scope: 'branch', storeId: input.branchValue };
}

export function useReportStores() {
    const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
    const [canConsolidate, setCanConsolidate] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        const load = async () => {
            try {
                const me = await fetchMe();
                if (!active) {
                    return;
                }

                const tenantId = getWorkspaceItem('tenant_id');
                const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === tenantId) || me?.tenants?.[0];
                setStores(tenant?.stores ?? []);
                setCanConsolidate(canViewConsolidatedReports(tenant?.role, tenant?.permissions));
            } catch {
                if (active) {
                    setStores([]);
                    setCanConsolidate(false);
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        void load();

        return () => {
            active = false;
        };
    }, []);

    return { stores, canConsolidate, loading };
}