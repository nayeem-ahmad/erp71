import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';

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

export function canViewConsolidatedReports(role: string | null | undefined, permissions?: string[]) {
    return role === 'OWNER' || hasPermission(permissions, 'VIEW_CONSOLIDATED_REPORTS');
}

export function getDefaultReportScope(storesCount: number, canConsolidate: boolean): ReportScopeMode {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(REPORT_SCOPE_KEY);
        if (saved === 'branch' || saved === 'company' || saved === 'compare') {
            if ((saved === 'company' || saved === 'compare') && !canConsolidate) {
                return 'branch';
            }
            return saved;
        }
    }

    if (!canConsolidate || storesCount <= 1) {
        return 'branch';
    }

    return 'company';
}

export function persistReportScope(scope: ReportScopeMode) {
    if (typeof window !== 'undefined') {
        localStorage.setItem(REPORT_SCOPE_KEY, scope);
    }
}

export function useReportStores() {
    const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
    const [canConsolidate, setCanConsolidate] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        const load = async () => {
            try {
                const me = await api.getMe();
                if (!active) {
                    return;
                }

                const tenantId = localStorage.getItem('tenant_id');
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