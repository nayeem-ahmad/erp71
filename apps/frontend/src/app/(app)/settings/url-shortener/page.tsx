'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Link2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, PageShell } from '@/components/ui';
import ShortLinkManager from '@/components/short-links/ShortLinkManager';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { hasPermission, isOwner } from '@/lib/permissions';
import { getWorkspaceItem } from '@/lib/session-store';

type PermissionState = 'checking' | 'allowed' | 'denied' | 'error';

export default function SettingsUrlShortenerPage() {
    const { t } = useI18n();
    const m = t.settings.urlShortener;

    // The backend gates list/create/revoke on MANAGE_SHORT_LINKS for every request
    // (not just writes), and ShortLinkManager doesn't surface fetchLinks() failures
    // to its parent — its own load() effect has no catch. So permission has to be
    // resolved here, before ShortLinkManager ever mounts, the same way
    // /crm/setup pre-checks with getMe() rather than relying on a caught 403.
    //
    // 'error' is deliberately distinct from 'denied': getMe() failing (network
    // blip, backend hiccup) tells us nothing about whether this user actually has
    // MANAGE_SHORT_LINKS. Collapsing that into 'denied' would tell a permitted shop
    // owner on a flaky connection they're not allowed to use a feature they are
    // allowed to use, with no way out but a reload.
    const [permission, setPermission] = useState<PermissionState>('checking');

    const checkPermission = useCallback(() => {
        setPermission('checking');
        api.getMe()
            .then((me: any) => {
                const tenant =
                    me?.tenants?.find((e: { id: string }) => e.id === getWorkspaceItem('tenant_id'))
                    ?? me?.tenants?.[0];
                setPermission(
                    isOwner(tenant?.role) || hasPermission(tenant?.permissions, 'MANAGE_SHORT_LINKS')
                        ? 'allowed'
                        : 'denied',
                );
            })
            .catch(() => setPermission('error'));
    }, []);

    useEffect(() => {
        checkPermission();
    }, [checkPermission]);

    const fetchLinks = useCallback(() => api.getShortLinks(), []);
    const createLink = useCallback(
        (data: { target_url: string; label?: string }) => api.createShortLink(data),
        [],
    );
    const revokeLink = useCallback((id: string) => api.revokeShortLink(id), []);

    if (permission === 'denied') {
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

    if (permission === 'error') {
        return (
            <PageShell maxWidth="narrow">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center space-y-3">
                    <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto" />
                    <h1 className="text-xl font-bold text-amber-900">{m.checkFailedTitle}</h1>
                    <p className="text-sm text-amber-800">{m.checkFailedDescription}</p>
                    <Button variant="secondary" onClick={checkPermission}>
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

                {permission === 'checking' && <p className="text-sm text-gray-500">{t.common.loading}</p>}

                {permission === 'allowed' && (
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
