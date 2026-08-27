'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DashboardVariant } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { extractTenantPlan } from '@/lib/nav-visibility';
import { tenantDashboardVariant } from '@/lib/plan-entitlements';
import AccountingDashboard from '@/components/dashboard/AccountingDashboard';
import CrmDashboard from '@/components/dashboard/CrmDashboard';
import RetailDashboard from '@/components/dashboard/RetailDashboard';
import PageShell from '@/components/ui/compact/PageShell';
import { getWorkspaceItem } from '@/lib/session-store';

type Resolved = {
    variant: DashboardVariant;
    userName: string;
    tenantName: string;
    renewalEnd: string | null;
};

/**
 * Picks a dashboard and gets out of the way. Which one a tenant sees comes from
 * `resolveDashboardVariant` — the plan's default, the workspace's own choice in
 * settings, then whether this user can actually read the ledger (or the pipeline).
 *
 * The variants are separate components on purpose: the previous single page
 * carried six `!accountingOnlyMode` guards, and every panel added to any side
 * made that worse.
 */
export default function DashboardPage() {
    const { t } = useI18n();
    const copy = t.dashboardHome;

    const [resolved, setResolved] = useState<Resolved | null>(null);

    useEffect(() => {
        let cancelled = false;

        api.getMe()
            .then((me) => {
                if (cancelled) return;
                const tenantId = typeof window !== 'undefined' ? getWorkspaceItem('tenant_id') : null;
                const { planCode, features, dashboardPreference, permissions } = extractTenantPlan(me, tenantId);
                const tenants = me?.tenants ?? [];
                const tenant = tenants.find((entry: { id: string }) => entry.id === tenantId) ?? tenants[0];

                setResolved({
                    variant: tenantDashboardVariant(planCode, features, dashboardPreference, permissions),
                    userName: me?.name || '',
                    tenantName: tenant?.name || '',
                    renewalEnd: tenant?.subscription?.current_period_end ?? null,
                });
            })
            .catch((reason) => {
                console.error('Failed to fetch dashboard user context:', reason);
                // Without the plan there is nothing to switch on, and retail is the
                // dashboard every plan has.
                if (!cancelled) {
                    setResolved({ variant: 'RETAIL', userName: '', tenantName: '', renewalEnd: null });
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        const base = hour < 12 ? copy.greetingMorning : hour < 17 ? copy.greetingAfternoon : copy.greetingEvening;
        return resolved?.userName ? `${base}, ${resolved.userName} 👋` : `${base} 👋`;
    }, [copy, resolved?.userName]);

    if (!resolved) {
        return (
            <PageShell maxWidth="full">
                <div className="space-y-4">
                    <div className="h-12 animate-pulse rounded-xl bg-gray-100" />
                    <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="h-24 animate-pulse rounded-xl bg-gray-100" />
                        ))}
                    </div>
                </div>
            </PageShell>
        );
    }

    const identity = {
        greeting,
        tenantName: resolved.tenantName || copy.yourBusiness,
        renewalEnd: resolved.renewalEnd,
    };

    if (resolved.variant === 'ACCOUNTING') return <AccountingDashboard {...identity} />;
    if (resolved.variant === 'CRM') return <CrmDashboard {...identity} />;
    return <RetailDashboard {...identity} />;
}
