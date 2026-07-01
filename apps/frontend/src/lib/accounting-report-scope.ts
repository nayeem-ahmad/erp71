import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type ReportScopeMode = 'branch' | 'company' | 'compare';

const REPORT_SCOPE_KEY = 'report_scope';

export function canUserConsolidate(role?: string): boolean {
    return role === 'OWNER' || role === 'ACCOUNTANT';
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
                setCanConsolidate(canUserConsolidate(tenant?.role));
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