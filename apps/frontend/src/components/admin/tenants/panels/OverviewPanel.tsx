'use client';

import { Building2, ShieldCheck, Users } from 'lucide-react';
import CompactSection from '@/components/ui/compact/CompactSection';
import { compactDensity } from '@/lib/ui/compact-density';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { TenantRecord } from '../types';

function StatCard({
    icon: Icon,
    label,
    value,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
}) {
    return (
        <div className={`${compactDensity.card} flex items-start justify-between gap-3`}>
            <div className="min-w-0">
                <p className={compactDensity.statLabel}>{label}</p>
                <p className={`${compactDensity.statValue} mt-1 text-gray-950`}>{value}</p>
            </div>
            <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        </div>
    );
}

export default function OverviewPanel({ tenant }: { tenant: TenantRecord }) {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const dp = m.detailPage;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard icon={Building2} label={m.infoCards.stores} value={String(tenant.store_count)} />
                <StatCard icon={Users} label={m.infoCards.users} value={String(tenant.user_count)} />
                <StatCard
                    icon={ShieldCheck}
                    label={m.infoCards.provider}
                    value={tenant.subscription?.provider_name || 'manual'}
                />
                <StatCard
                    icon={Building2}
                    label={m.columns.ledgerBalance}
                    value={`৳${Number(tenant.ledger_balance ?? 0).toFixed(2)}`}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CompactSection>
                    <p className="text-sm font-semibold text-gray-900">{m.owner}</p>
                    <div className="mt-3 space-y-1">
                        <p className="text-sm font-semibold text-gray-900">
                            {tenant.owner?.name || m.unknownOwner}
                        </p>
                        <p className="text-xs text-gray-500">{tenant.owner?.email || m.noOwnerEmail}</p>
                    </div>
                    <div className="mt-3 border-t border-gray-100 pt-3 flex flex-wrap gap-6">
                        <div>
                            <p className={compactDensity.formLabel}>{dp.tenantId}</p>
                            <p className="mt-0.5 text-xs font-mono text-gray-700">{tenant.id}</p>
                        </div>
                        <div>
                            <p className={compactDensity.formLabel}>{m.columns.created}</p>
                            <p className="mt-0.5 text-xs text-gray-700">{formatDate(tenant.created_at)}</p>
                        </div>
                    </div>
                </CompactSection>

                <CompactSection title={m.storesSection}>
                    <div className="space-y-2">
                        {tenant.stores.length === 0 ? (
                            <p className="text-xs text-gray-500">{dp.noStores}</p>
                        ) : tenant.stores.map((store) => (
                            <div key={store.id} className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-sm font-semibold text-gray-900">{store.name}</p>
                                <p className="mt-0.5 text-xs text-gray-500">{store.address || m.noAddress}</p>
                            </div>
                        ))}
                    </div>
                </CompactSection>
            </div>

            <CompactSection>
                <p className="text-sm font-semibold text-gray-900">{m.usersSection}</p>
                <p className="mt-0.5 text-xs text-gray-500">{t.admin.users.tenantUsers.description}</p>
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[13px]">
                        <thead>
                            <tr className="bg-gray-50/80 border-y border-gray-200">
                                <th className="text-start px-2 py-1.5 text-xs font-medium text-gray-500">
                                    {t.admin.users.tenantUsers.columns.name}
                                </th>
                                <th className="text-start px-2 py-1.5 text-xs font-medium text-gray-500">
                                    {t.admin.users.tenantUsers.columns.email}
                                </th>
                                <th className="text-start px-2 py-1.5 text-xs font-medium text-gray-500">
                                    {t.admin.users.tenantUsers.columns.role}
                                </th>
                                <th className="text-start px-2 py-1.5 text-xs font-medium text-gray-500 hidden md:table-cell">
                                    {t.admin.users.tenantUsers.columns.joined}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {tenant.users.map((user) => (
                                <tr key={user.id}>
                                    <td className="px-2 py-1.5 font-semibold text-gray-900">{user.name || user.email}</td>
                                    <td className="px-2 py-1.5 text-gray-600">{user.email}</td>
                                    <td className="px-2 py-1.5">
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1.5 text-gray-500 hidden md:table-cell">
                                        {user.joined_at ? formatDate(user.joined_at) : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CompactSection>
        </div>
    );
}
