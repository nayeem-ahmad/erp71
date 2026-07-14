'use client';

import PageHeader from '@/components/ui/compact/PageHeader';
import SystemHealthPanel from '@/components/platform/SystemHealthPanel';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

export default function SystemHealthPage() {
    const { t } = useI18n();
    const m = t.admin.systemHealth;

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-8">
                <PageHeader
                    title={m.title}
                    subtitle={m.description}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
                    )}
                />

                <SystemHealthPanel />
            </div>
        </div>
    );
}