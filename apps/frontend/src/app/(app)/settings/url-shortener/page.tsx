'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Link2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import ShortLinkManager from '@/components/short-links/ShortLinkManager';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { hasPermission, isOwner } from '@/lib/permissions';

export default function SettingsUrlShortenerPage() {
    const { t } = useI18n();
    const m = t.settings.urlShortener;

    // The backend gates list/create/revoke on MANAGE_SHORT_LINKS for every request
    // (not just writes), and ShortLinkManager doesn't surface fetchLinks() failures
    // to its parent — its own load() effect has no catch. So permission has to be
    // resolved here, before ShortLinkManager ever mounts, the same way
    // /crm/setup pre-checks with getMe() rather than relying on a caught 403.
    const [allowed, setAllowed] = useState<boolean | null>(null);

    useEffect(() => {
        api.getMe()
            .then((me: any) => {
                const tenant =
                    me?.tenants?.find((e: { id: string }) => e.id === localStorage.getItem('tenant_id'))
                    ?? me?.tenants?.[0];
                setAllowed(isOwner(tenant?.role) || hasPermission(tenant?.permissions, 'MANAGE_SHORT_LINKS'));
            })
            .catch(() => setAllowed(false));
    }, []);

    const fetchLinks = useCallback(() => api.getShortLinks(), []);
    const createLink = useCallback(
        (data: { target_url: string; label?: string }) => api.createShortLink(data),
        [],
    );
    const revokeLink = useCallback((id: string) => api.revokeShortLink(id), []);

    if (allowed === false) {
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

                {allowed === null && <p className="text-sm text-gray-500">{t.common.loading}</p>}

                {allowed && (
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
