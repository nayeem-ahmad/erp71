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
    const m = t.admin.urlShortener;

    const fetchLinks = useCallback(() => api.getAdminShortLinks(), []);
    const createLink = useCallback(
        (data: { target_url: string; label?: string }) => api.createAdminShortLink(data),
        [],
    );
    const revokeLink = useCallback((id: string) => api.revokeAdminShortLink(id), []);

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
                    )}
                />

                <ShortLinkManager
                    description={m.description}
                    placeholder={m.placeholder}
                    fetchLinks={fetchLinks}
                    createLink={createLink}
                    revokeLink={revokeLink}
                />
            </div>
        </PageShell>
    );
}
