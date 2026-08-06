'use client';

import { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import { PageShell, StatusBadge } from '@/components/ui';
import type { ReferralCommission } from '@/components/admin/referrals/types';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useRefereeLedger } from '../use-referee-ledger';

const helper = createColumnHelper<ReferralCommission>();

export default function SignupsPage() {
    const { t } = useI18n();
    const m = t.referralPortal;
    const page = m.signupsPage;
    const { ledger, error, isLoading } = useRefereeLedger();

    const columns: ColumnDef<ReferralCommission, unknown>[] = useMemo(() => [
        helper.accessor((row) => row.tenant?.name ?? row.tenant_id, {
            id: 'tenant',
            header: page.columns.tenant,
            cell: (info) => <span className="font-medium text-gray-900">{info.getValue()}</span>,
        }),
        helper.accessor('status', {
            header: page.columns.status,
            cell: (info) => {
                const status = info.getValue();
                const tone = status === 'PAID'
                    ? 'success'
                    : status === 'EARNED'
                        ? 'warning'
                        : status === 'REVERSED'
                            ? 'danger'
                            : 'neutral';
                return <StatusBadge tone={tone}>{m.status[status]}</StatusBadge>;
            },
        }),
        helper.accessor('plan_amount', {
            header: page.columns.planAmount,
            meta: { hideOnMobile: true },
            cell: (info) => {
                const value = info.getValue();
                return value !== null ? formatBDT(Number(value)) : '—';
            },
        }),
        helper.accessor('commission_pct', {
            header: page.columns.commissionPct,
            meta: { hideOnMobile: true },
            cell: (info) => `${Number(info.getValue())}%`,
        }),
        helper.accessor('commission_amount', {
            header: page.columns.commission,
            cell: (info) => {
                const value = info.getValue();
                return value !== null
                    ? <span className="font-semibold text-emerald-700">{formatBDT(Number(value))}</span>
                    : '—';
            },
        }),
        helper.accessor('signed_up_at', {
            header: page.columns.signedUp,
            cell: (info) => formatDate(info.getValue()),
        }),
        helper.accessor('earned_at', {
            header: page.columns.earnedOn,
            meta: { hideOnMobile: true },
            cell: (info) => {
                const value = info.getValue();
                return value ? formatDate(value) : '—';
            },
        }),
    ], [m, page]);

    const filterPresets = useMemo(() => [
        { label: page.filterPresets.pending, filters: [{ id: 'status', value: 'PENDING' }] },
        { label: page.filterPresets.earned, filters: [{ id: 'status', value: 'EARNED' }] },
        { label: page.filterPresets.paid, filters: [{ id: 'status', value: 'PAID' }] },
        { label: page.filterPresets.reversed, filters: [{ id: 'status', value: 'REVERSED' }] },
    ], [page]);

    return (
        <PageShell>
            <PageHeader
                title={page.title}
                subtitle={page.subtitle}
                breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [
                    { label: m.breadcrumb, href: routes.referralsPortal.root },
                    { label: page.title },
                ])}
            />

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {error}
                </div>
            )}

            {/* The one-shot rule is the question partners ask most, and this is now
                the page where it comes up. */}
            <p className="text-xs text-gray-500">{m.commissionNote}</p>

            <DataTable
                tableId="referee-portal-signups"
                data={ledger?.commissions ?? []}
                columns={columns}
                title={page.title}
                isLoading={isLoading}
                emptyMessage={page.empty}
                emptyIcon={<Users className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={page.searchPlaceholder}
                filterPresets={filterPresets}
            />
        </PageShell>
    );
}
