'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Link2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, PageShell } from '@/components/ui';
import ShortLinkManager from '@/components/short-links/ShortLinkManager';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { extractTenantPlan } from '@/lib/nav-visibility';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { canUseUrlShortener } from '@/lib/plan-entitlements';
import { routes } from '@/lib/routes';
import { hasPermission, isOwner } from '@/lib/permissions';
import { getWorkspaceItem } from '@/lib/session-store';

type AccessState = 'checking' | 'allowed' | 'notOnPlan' | 'denied' | 'error';

export default function SettingsUrlShortenerPage() {
    const { t } = useI18n();
    const m = t.settings.urlShortener;

    // The backend gates list/create/revoke on the `urlShortener` plan entitlement
    // and on MANAGE_SHORT_LINKS for every request (not just writes), and
    // ShortLinkManager fetches the moment it mounts. So access has to be resolved
    // here, before it ever mounts, the same way /crm/setup pre-checks with getMe()
    // rather than relying on a caught 403.
    //
    // The plan is checked before the permission: below Business, granting the
    // permission would open nothing, so "ask for access" would be the wrong advice.
    //
    // 'error' is deliberately distinct from 'notOnPlan' and 'denied': getMe()
    // failing (network blip, backend hiccup) tells us nothing about this user's
    // plan or permissions. Collapsing it into either would tell a Business shop
    // owner on a flaky connection they can't use a tool they can, with no way out
    // but a reload.
    const [access, setAccess] = useState<AccessState>('checking');

    const checkAccess = useCallback(() => {
        setAccess('checking');
        api.getMe()
            .then((me: any) => {
                const { planCode, features, role, permissions } = extractTenantPlan(
                    me,
                    getWorkspaceItem('tenant_id'),
                );
                if (!canUseUrlShortener(planCode, features)) {
                    setAccess('notOnPlan');
                } else if (isOwner(role) || hasPermission(permissions, 'MANAGE_SHORT_LINKS')) {
                    setAccess('allowed');
                } else {
                    setAccess('denied');
                }
            })
            .catch(() => setAccess('error'));
    }, []);

    useEffect(() => {
        checkAccess();
    }, [checkAccess]);

    const fetchLinks = useCallback(() => api.getShortLinks(), []);
    const createLink = useCallback(
        (data: { target_url: string; label?: string }) => api.createShortLink(data),
        [],
    );
    const revokeLink = useCallback((id: string) => api.revokeShortLink(id), []);

    if (access === 'notOnPlan') {
        return (
            <PageShell maxWidth="narrow">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-8 text-center space-y-3">
                    <Link2 className="w-10 h-10 text-blue-600 mx-auto" />
                    <h1 className="text-xl font-bold text-gray-900">{m.notOnPlanTitle}</h1>
                    <p className="text-sm text-gray-700">{m.notOnPlanDescription}</p>
                    <Link
                        href={routes.billing}
                        className="inline-flex min-h-touch items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        {m.viewPlans}
                    </Link>
                </div>
            </PageShell>
        );
    }

    if (access === 'denied') {
        return (
            <PageShell maxWidth="narrow">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center space-y-3">
                    <Link2 className="w-10 h-10 text-amber-600 mx-auto" />
                    <h1 className="text-xl font-bold text-amber-900">{m.forbiddenTitle}</h1>
                    <p className="text-sm text-amber-800">{m.forbiddenDescription}</p>
                    <Link
                        href={routes.settings.root}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900 hover:underline"
                    >
                        {t.common.back}
                    </Link>
                </div>
            </PageShell>
        );
    }

    if (access === 'error') {
        return (
            <PageShell maxWidth="narrow">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center space-y-3">
                    <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto" />
                    <h1 className="text-xl font-bold text-amber-900">{m.checkFailedTitle}</h1>
                    <p className="text-sm text-amber-800">{m.checkFailedDescription}</p>
                    <Button variant="secondary" onClick={checkAccess}>
                        {m.retry}
                    </Button>
                </div>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.accountSettings,
                        m.title,
                        'settings',
                    )}
                />

                {access === 'checking' && <p className="text-sm text-gray-500">{t.common.loading}</p>}

                {access === 'allowed' && (
                    <ShortLinkManager
                        description={m.description}
                        placeholder={m.placeholder}
                        fetchLinks={fetchLinks}
                        createLink={createLink}
                        revokeLink={revokeLink}
                    />
                )}
            </div>
        </PageShell>
    );
}
