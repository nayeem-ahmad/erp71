'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Wallet } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PaymentDetailModal from '@/components/referrals/PaymentDetailModal';
import type { RefereePayment } from '@/components/admin/referrals/types';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useRefereeLedger } from '../use-referee-ledger';

const helper = createColumnHelper<RefereePayment>();

export default function PaymentsPage() {
    const { t } = useI18n();
    const m = t.referralPortal;
    const page = m.paymentsPage;
    const { ledger, error, isLoading } = useRefereeLedger();
    const [selected, setSelected] = useState<RefereePayment | null>(null);

    const columns: ColumnDef<RefereePayment, unknown>[] = useMemo(() => [
        helper.accessor('paid_at', {
            header: page.columns.date,
            cell: (info) => formatDate(info.getValue()),
        }),
        helper.accessor('amount', {
            header: page.columns.amount,
            cell: (info) => (
                <span className="font-semibold text-emerald-700">{formatBDT(Number(info.getValue()))}</span>
            ),
        }),
        helper.accessor('method', {
            header: page.columns.method,
            cell: (info) => info.getValue() ?? '—',
        }),
        helper.accessor('reference', {
            header: page.columns.reference,
            meta: { hideOnMobile: true },
            cell: (info) => info.getValue() ?? '—',
        }),
        helper.accessor('notes', {
            header: page.columns.notes,
            meta: { hideOnMobile: true },
            cell: (info) => info.getValue() ?? '—',
        }),
        helper.display({
            id: 'actions',
            header: page.columns.actions,
            cell: (info) => (
                <button
                    type="button"
                    onClick={() => setSelected(info.row.original)}
                    className="min-h-touch rounded-lg px-2 text-sm font-semibold text-blue-600 hover:underline"
                >
                    {page.view}
                </button>
            ),
        }),
    ], [page]);

    return (
        <PageShell>
            <PageHeader
                title={page.title}
                subtitle={page.subtitle}
                breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [
                    { label: m.breadcrumb, href: '/referrals' },
                    { label: page.title },
                ])}
            />

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {error}
                </div>
            )}

            <DataTable
                tableId="referee-portal-payments"
                data={ledger?.payments ?? []}
                columns={columns}
                title={page.title}
                isLoading={isLoading}
                emptyMessage={page.empty}
                emptyIcon={<Wallet className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={page.searchPlaceholder}
            />

            {selected && (
                <PaymentDetailModal
                    payment={selected}
                    labels={page.detail}
                    onClose={() => setSelected(null)}
                />
            )}
        </PageShell>
    );
}
