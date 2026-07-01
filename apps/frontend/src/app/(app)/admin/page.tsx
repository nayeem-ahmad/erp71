'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Users, TrendingUp, ShieldCheck, ArrowRight, Loader2, Settings, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

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
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-8">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck className="w-5 h-5 text-indigo-600" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{m.badge}</p>
                    </div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{m.title}</h1>
                    <p className="mt-1 text-sm text-gray-500">{m.description}</p>
                </div>

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
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

                        <div className="rounded-3xl border border-gray-100 bg-white p-6 space-y-4">
                            <h2 className="text-sm font-black uppercase tracking-widest text-gray-400">{m.subscriptionBreakdown}</h2>
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
        </div>
    );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
    const colors: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-600',
        violet: 'bg-violet-50 text-violet-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        amber: 'bg-amber-50 text-amber-600',
    };
    return (
        <div className="rounded-3xl border border-gray-100 bg-white p-5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${colors[color]}`}>
                <Icon className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold tracking-tight text-gray-950">{value.toLocaleString()}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-gray-400">{label}</p>
        </div>
    );
}

function SubBadge({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={`rounded-2xl px-4 py-3 flex items-center justify-between ${color}`}>
            <span className="text-xs font-black uppercase tracking-widest">{label}</span>
            <span className="text-xl font-black">{value}</span>
        </div>
    );
}

function QuickLink({ href, icon: Icon, title, description }: { href: string; icon: any; title: string; description: string }) {
    return (
        <Link href={href} className="group rounded-3xl border border-gray-100 bg-white p-6 hover:border-indigo-200 hover:bg-indigo-50/30 transition block">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
                        <Icon className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-black text-gray-900">{title}</h3>
                    <p className="mt-1 text-xs text-gray-500 leading-relaxed">{description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 mt-1 shrink-0 transition" />
            </div>
        </Link>
    );
}