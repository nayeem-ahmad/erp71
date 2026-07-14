'use client';

import Link from 'next/link';
import { Activity } from 'lucide-react';
import SystemHealthPanel from '@/components/platform/SystemHealthPanel';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

export default function StatusPage() {
    const { t } = useI18n();
    const m = t.marketing.status;
    const admin = t.admin.systemHealth;

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full max-w-5xl mx-auto space-y-8">
                <PageHeader
                    title={m.title}
                    subtitle={(
                        <>
                            <span>{m.description}</span>
                            <span className="block mt-2 text-xs font-semibold text-indigo-600">{m.adminOnly}</span>
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
                            className="inline-flex items-center gap-2 self-start rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50"
                        >
                            <Activity className="w-4 h-4" />
                            {m.openFullDashboard}
                        </Link>
                    )}
                />

                <SystemHealthPanel />
            </div>
        </div>
    );
}