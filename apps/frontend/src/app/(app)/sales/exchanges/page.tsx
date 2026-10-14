'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { compactDensity } from '@/lib/ui/compact-density';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { BranchFilter, PageShell } from '@/components/ui';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import type { SettlementMode } from '@/lib/exchange-settlement';

interface SalesExchange {
    id: string;
    exchange_number: string;
    created_at: string;
    returned_total: string | number;
    replacement_total: string | number;
    difference: string | number;
    settlement_mode: string;
    status?: string;
    sale?: {
        id: string;
        serial_number?: string | null;
        customer?: { name?: string | null } | null;
    } | null;
}

const statusColors: Record<string, string> = {
    COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

const columnHelper = createColumnHelper<SalesExchange>();

export default function ExchangesPage() {
    const { t, locale } = useI18n();
    const router = useRouter();
    const branch = useBranchScope();
    const copy = t.exchanges;
    const [exchanges, setExchanges] = useState<SalesExchange[]>([]);
    const [loading, setLoading] = useState(true);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    useEffect(() => {
        if (!branch.ready) return;
        void loadExchanges();
    }, [createdRange, branch.ready, branch.apiStoreId]);

    const loadExchanges = async () => {
        setLoading(true);
        try {
            const data = await api.getExchanges({ ...applyCreatedRangeQuery(createdRange), storeId: branch.apiStoreId });
            setExchanges(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load exchanges', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<SalesExchange, any>[] = useMemo(
        () => [
            columnHelper.accessor('exchange_number', {
                header: copy.columns.number,
                cell: (info) => (
                    <Link
                        href={routes.sales.exchangeDetail(info.row.original.id)}
                        className="text-sm font-semibold text-gray-900 hover:text-blue-600"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            createdAtColumn(columnHelper, { header: copy.columns.date, locale }),
            columnHelper.accessor((row) => row.sale?.serial_number ?? '', {
                id: 'invoice',
                header: copy.columns.originalInvoice,
                cell: (info) => {
                    const sale = info.row.original.sale;
                    if (!sale?.id) return <span className="text-sm text-gray-400">{t.shared.dash}</span>;
                    return (
                        <Link
                            href={routes.sales.detail(sale.id)}
                            className="text-sm font-mono text-blue-600 hover:underline"
                        >
                            {sale.serial_number || t.shared.dash}
                        </Link>
                    );
                },
                size: 150,
            }),
            columnHelper.accessor((row) => row.sale?.customer?.name ?? '', {
                id: 'customer',
                header: copy.columns.customer,
                cell: (info) => (
                    <span className="text-sm text-gray-700">{info.getValue() || t.shared.dash}</span>
                ),
                meta: { hideOnMobile: true },
                size: 160,
            }),
            columnHelper.accessor('returned_total', {
                header: copy.columns.returnedTotal,
                cell: (info) => (
                    <span className="text-sm text-gray-900">{formatBDT(Number(info.getValue()), { locale })}</span>
                ),
                sortingFn: (a, b) => Number(a.original.returned_total) - Number(b.original.returned_total),
                size: 120,
            }),
            columnHelper.accessor('replacement_total', {
                header: copy.columns.replacementTotal,
                cell: (info) => (
                    <span className="text-sm text-gray-900">{formatBDT(Number(info.getValue()), { locale })}</span>
                ),
                sortingFn: (a, b) => Number(a.original.replacement_total) - Number(b.original.replacement_total),
                size: 130,
            }),
            columnHelper.accessor('difference', {
                header: copy.columns.difference,
                cell: (info) => (
                    <span className="text-sm font-semibold text-gray-900">
                        {formatBDT(Number(info.getValue()), { locale })}
                    </span>
                ),
                sortingFn: (a, b) => Number(a.original.difference) - Number(b.original.difference),
                size: 120,
            }),
            columnHelper.accessor('settlement_mode', {
                header: copy.columns.settled,
                cell: (info) => {
                    const mode = info.getValue() as SettlementMode;
                    return (
                        <span className="text-sm text-gray-700">{copy.tender[mode] ?? info.getValue()}</span>
                    );
                },
                meta: { hideOnMobile: true },
                size: 110,
            }),
            columnHelper.accessor((row) => row.status ?? 'COMPLETED', {
                id: 'status',
                header: copy.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    const label = copy.status[status as keyof typeof copy.status] ?? status;
                    return (
                        <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                                statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                        >
                            {label}
                        </span>
                    );
                },
                size: 120,
            }),
        ],
        [copy, locale, t.shared.dash],
    );

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    copy.title,
                    'sales',
                )}
                actions={
                    <>
                        <BranchFilter scope={branch} />
                        <Link
                            href={routes.sales.exchangeNew}
                            className={`${compactDensity.btnPrimary} bg-blue-600 hover:bg-blue-700 text-white min-h-touch text-sm`}
                        >
                            <Plus className="w-4 h-4" />
                            {copy.newExchange}
                        </Link>
                    </>
                }
            />

            <div className="flex flex-wrap items-center gap-2">
                <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
            </div>

            <DataTable<SalesExchange>
                tableId="sales-exchanges"
                columns={columns}
                data={exchanges}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<ArrowLeftRight className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                onRowClick={(row) => router.push(routes.sales.exchangeDetail(row.id))}
            />
        </PageShell>
    );
}
