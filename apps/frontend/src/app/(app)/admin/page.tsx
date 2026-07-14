'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Users, TrendingUp, ShieldCheck, ArrowRight, Loader2, Settings, Activity } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

type Metrics = {
    total_tenants: number;
    total_users: number;
    new_tenants_this_month: number;
    subscriptions: {
        active: number;
        trialing: number;
        past_due: number;
        cancelled: number;
    };
};

export default function PlatformAdminPage() {
    const { t } = useI18n();
    const m = t.admin.overview;
    const [metrics, setMetrics] = useState<Metrics | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        api.getAdminMetrics()
            .then((data: any) => setMetrics(data))
            .catch((err: any) => setError(err.message || m.loadFailed))
            .finally(() => setIsLoading(false));
    }, [m.loadFailed]);

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

                {error && (
                    <div className="rounded-lg border border-red-200 bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">{error}</div>
                )}

                {isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> {m.loadingMetrics}</div>
                ) : metrics && (
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <StatCard icon={Building2} label={m.stats.totalTenants} value={metrics.total_tenants} color="blue" />
                            <StatCard icon={Users} label={m.stats.totalUsers} value={metrics.total_users} color="violet" />
                            <StatCard icon={TrendingUp} label={m.stats.newThisMonth} value={metrics.new_tenants_this_month} color="emerald" />
                            <StatCard icon={ShieldCheck} label={m.stats.activeSubscriptions} value={metrics.subscriptions.active} color="amber" />
                        </div>

                        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm space-y-4">
                            <h2 className="text-xs font-medium text-gray-500">{m.subscriptionBreakdown}</h2>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <SubBadge label={m.subscriptionStatus.active} value={metrics.subscriptions.active} color="bg-emerald-100 text-emerald-700" />
                                <SubBadge label={m.subscriptionStatus.trialing} value={metrics.subscriptions.trialing} color="bg-blue-100 text-blue-700" />
                                <SubBadge label={m.subscriptionStatus.pastDue} value={metrics.subscriptions.past_due} color="bg-amber-100 text-amber-700" />
                                <SubBadge label={m.subscriptionStatus.cancelled} value={metrics.subscriptions.cancelled} color="bg-red-100 text-red-700" />
                            </div>
                        </div>
                    </>
                )}

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

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
    const colors: Record<string, string> = {
        blue: 'bg-primary-light text-blue-700',
        violet: 'bg-primary-light text-blue-700',
        emerald: 'bg-success-light text-success-text',
        amber: 'bg-warning-light text-warning-text',
    };
    return (
        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${colors[color]}`}>
                <Icon className="w-4 h-4" />
            </div>
            <p className="text-xl font-bold text-gray-900">{value.toLocaleString()}</p>
            <p className="mt-1 text-xs font-medium text-gray-500">{label}</p>
        </div>
    );
}

function SubBadge({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={`rounded-lg px-4 py-3 flex items-center justify-between ${color}`}>
            <span className="text-xs font-semibold">{label}</span>
            <span className="text-xl font-bold">{value}</span>
        </div>
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