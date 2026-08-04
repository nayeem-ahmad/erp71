'use client';

import Link from 'next/link';
import { Building2, Users, ArrowRight, Settings, Activity } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import AdminDashboard from '@/components/dashboard/AdminDashboard';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/**
 * Admin > Overview. The four stat tiles and the status badge row that used to
 * live here are now the platform dashboard's attention strip and KPI band —
 * same figures, plus deltas, which the tiles never had. The quick links stay
 * below it, the way every module Overview keeps its hub.
 */
export default function PlatformAdminPage() {
    const { t } = useI18n();
    const m = t.admin.overview;

    return (
        <PageShell>
            <div className="space-y-4">
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

                <AdminDashboard variant="embedded" greeting="" tenantName="" renewalEnd={null} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <QuickLink href="/admin/tenants" icon={Building2} title={m.quickLinks.tenants.title} description={m.quickLinks.tenants.description} />
                    <QuickLink href="/admin/users" icon={Users} title={m.quickLinks.users.title} description={m.quickLinks.users.description} />
                    <QuickLink href="/admin/platform-settings" icon={Settings} title={m.quickLinks.platformSettings.title} description={m.quickLinks.platformSettings.description} />
                    <QuickLink href="/admin/system-health" icon={Activity} title={t.admin.systemHealth.quickLink.title} description={t.admin.systemHealth.quickLink.description} />
                    <QuickLink href="/status" icon={Activity} title={t.marketing.status.title} description={t.marketing.status.adminOnly} />
                </div>
            </div>
        </PageShell>
    );
}

function QuickLink({ href, icon: Icon, title, description }: { href: string; icon: any; title: string; description: string }) {
    return (
        <Link href={href} className="group rounded-lg border border-gray-100 bg-white p-4 shadow-sm hover:border-primary-border hover:bg-primary-light/30 transition block">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="w-9 h-9 rounded-lg bg-primary-light text-blue-700 flex items-center justify-center mb-3">
                        <Icon className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                    <p className="mt-1 text-xs text-gray-500 leading-relaxed">{description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-primary mt-1 shrink-0 transition" />
            </div>
        </Link>
    );
}