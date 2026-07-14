'use client';

import Link from 'next/link';
import { Activity } from 'lucide-react';
import SystemHealthPanel from '@/components/platform/SystemHealthPanel';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';

export default function StatusPage() {
    const { t } = useI18n();
    const m = t.marketing.status;
    const admin = t.admin.systemHealth;

    return (
        <PageShell>
            <div className="w-full max-w-5xl mx-auto space-y-8">
                <PageHeader
                    title={m.title}
                    subtitle={(
                        <>
                            <span>{m.description}</span>
                            <span className="block mt-2 text-xs font-semibold text-primary">{m.adminOnly}</span>
                        </>
                    )}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        m.title,
                        m.title,
                        'status',
                    )}
                    actions={(
                        <Link
                            href={routes.admin.systemHealth}
                            className="inline-flex items-center gap-2 self-start rounded-xl border border-primary-border bg-white px-4 py-2 text-sm font-bold text-primary hover:bg-primary-light"
                        >
                            <Activity className="w-4 h-4" />
                            {m.openFullDashboard}
                        </Link>
                    )}
                />

                <SystemHealthPanel />
            </div>
        </PageShell>
    );
}