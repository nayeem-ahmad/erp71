'use client';

import { useEffect, useMemo } from 'react';
import type { DashboardVariant } from '@erp71/shared-types';
import { useMe } from '@/hooks/use-me';
import { useI18n } from '@/lib/i18n';
import { extractTenantPlan } from '@/lib/nav-visibility';
import { tenantDashboardVariant } from '@/lib/plan-entitlements';
import AccountingDashboard from '@/components/dashboard/AccountingDashboard';
import CrmDashboard from '@/components/dashboard/CrmDashboard';
import ProjectsDashboard from '@/components/dashboard/ProjectsDashboard';
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
 *
 * The choice is read off the shared `/auth/me` cache. The app shell is fetching
 * the same answer as this page mounts, so this used to be a second request the
 * page waited on before any card could start loading; now it joins the shell's,
 * and on a return visit the variant is known on the first render.
 */
export default function DashboardPage() {
    const { t } = useI18n();
    const copy = t.dashboardHome;

    const { data: me, isError, error } = useMe();
    const tenantId = getWorkspaceItem('tenant_id');

    const resolved = useMemo<Resolved | null>(() => {
        if (me !== undefined) {
            const { planCode, features, dashboardPreference, permissions } = extractTenantPlan(me, tenantId);
            const tenants = me?.tenants ?? [];
            const tenant = tenants.find((entry: { id: string }) => entry.id === tenantId) ?? tenants[0];
            return {
                variant: tenantDashboardVariant(planCode, features, dashboardPreference, permissions),
                userName: me?.name || '',
                tenantName: tenant?.name || '',
                renewalEnd: tenant?.subscription?.current_period_end ?? null,
            };
        }
        // Without the plan there is nothing to switch on, and retail is the
        // dashboard every plan has.
        if (isError) return { variant: 'RETAIL', userName: '', tenantName: '', renewalEnd: null };
        return null;
    }, [me, isError, tenantId]);

    useEffect(() => {
        if (isError && me === undefined) console.error('Failed to fetch dashboard user context:', error);
    }, [isError, me, error]);

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
    if (resolved.variant === 'PROJECTS') return <ProjectsDashboard {...identity} />;
    return <RetailDashboard {...identity} />;
}
