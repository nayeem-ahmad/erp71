'use client';

import { useCallback } from 'react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import ShortLinkManager from '@/components/short-links/ShortLinkManager';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

export default function AdminUrlShortenerPage() {
    const { t } = useI18n();

    const fetchLinks = useCallback(() => api.getAdminShortLinks(), []);
    const createLink = useCallback(
        (data: { target_url: string; label?: string }) => api.createAdminShortLink(data),
        [],
    );
    const revokeLink = useCallback((id: string) => api.revokeAdminShortLink(id), []);

    const title = t.sidebar.items.urlShortener;

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={title}
                    subtitle="Platform-owned short links, visible across every tenant."
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        title,
                        'admin',
                    )}
                />

                <ShortLinkManager
                    description="Links created here belong to the platform, not to any tenant. This list spans every tenant."
                    placeholder="https://example.com/page or /settings/branding"
                    fetchLinks={fetchLinks}
                    createLink={createLink}
                    revokeLink={revokeLink}
                />
            </div>
        </PageShell>
    );
}
