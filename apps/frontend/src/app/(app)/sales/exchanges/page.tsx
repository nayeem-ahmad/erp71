'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Eye, PackageMinus, PackagePlus, Plus } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { api, type SalesExchangeListFilterParams, type SalesExchangeListSummary } from '@/lib/api';
import { routes } from '@/lib/routes';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { BranchFilter, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import type { SettlementMode } from '@/lib/exchange-settlement';
import { customerListFilter } from '../components/customer-list-filter';

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

const EXCHANGE_STATUSES = ['COMPLETED', 'CANCELLED'] as const;
const SETTLEMENT_MODES: SettlementMode[] = ['cash', 'bank', 'bkash', 'nagad', 'credit'];

const statusTones: Record<string, StatusBadgeTone> = {
    COMPLETED: 'success',
    // Void, not an error — as on the Sales list.
    CANCELLED: 'neutral',
};

const columnHelper = createColumnHelper<SalesExchange>();

export default function ExchangesPage() {
    const { t, locale, fmt } = useI18n();
    const router = useRouter();
    const branch = useBranchScope();
    const copy = t.exchanges;

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [customerIds, setCustomerIds] = useState<string[]>([]);
    const [differenceFilter, setDifferenceFilter] = useState<NumberCondition | null>(null);
    const [settlementModes, setSettlementModes] = useState<string[]>([]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // An exchange is dated when it is posted, so its one date is `created_at`.
    // The amount condition is the difference: positive when the customer paid.
    const filterParams = useMemo<SalesExchangeListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            status: statusFilter.length ? statusFilter.join(',') : undefined,
            statusExclude,
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            customerIds,
            total: differenceFilter,
            settlementModes,
        }),
        [debouncedSearch, statusFilter, statusExclude, createdRange, branch.apiStoreId, customerIds, differenceFilter, settlementModes],
    );

    const { items: exchanges, loading, error: listError, serverPagination } = useServerList<SalesExchange>({
        tableId: 'sales-exchanges',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getExchangesList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading } = useListSummary<SalesExchangeListFilterParams, SalesExchangeListSummary>({
        fetch: api.getExchangesListSummary,
        params: filterParams,
        enabled: branch.ready,
    });

    const columns: ColumnDef<SalesExchange, any>[] = useMemo(
        () => [
            columnHelper.accessor('exchange_number', {
                header: copy.columns.number,
                cell: (info) => (
                    <Link
                        href={routes.sales.exchangeDetail(info.row.original.id)}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            createdAtColumn(columnHelper, { header: copy.columns.date, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.sale?.serial_number ?? '', {
                id: 'invoice',
                header: copy.columns.originalInvoice,
                cell: (info) => {
                    const sale = info.row.original.sale;
                    if (!sale?.id) return <span className="text-gray-400">{t.shared.dash}</span>;
                    return (
                        <Link href={routes.sales.detail(sale.id)} className="text-blue-600 hover:underline">
                            {sale.serial_number || t.shared.dash}
                        </Link>
                    );
                },
                size: 150,
            }),
            columnHelper.accessor((row) => row.sale?.customer?.name ?? '', {
                id: 'customer',
                header: copy.columns.customer,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.shared.walkIn}</span>,
                meta: { hideOnMobile: true },
                size: 160,
            }),
            columnHelper.accessor('returned_total', {
                header: copy.columns.returnedTotal,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                meta: { align: 'end', hideOnMobile: true },
                size: 120,
            }),
            columnHelper.accessor('replacement_total', {
                header: copy.columns.replacementTotal,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                meta: { align: 'end', hideOnMobile: true },
                size: 130,
            }),
            columnHelper.accessor('difference', {
                header: copy.columns.difference,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                meta: { align: 'end' },
                size: 120,
            }),
            columnHelper.accessor('settlement_mode', {
                header: copy.columns.settled,
                cell: (info) => copy.list.settlementModes[info.getValue() as SettlementMode] ?? info.getValue(),
                meta: { hideOnMobile: true },
                size: 110,
            }),
            columnHelper.accessor((row) => row.status ?? 'COMPLETED', {
                id: 'status',
                header: copy.columns.status,
                enableSorting: false,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                            {copy.status[status as keyof typeof copy.status] ?? status}
                        </StatusBadge>
                    );
                },
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.returns.columns.actions,
                cell: (info) => (
                    <RowActions>
                        <RowActionButton
                            icon={<Eye />}
                            label={t.common.view}
                            href={routes.sales.exchangeDetail(info.row.original.id)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 80,
            }),
        ],
        [copy, locale, t],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'created',
                type: 'date-range',
                label: copy.columns.date,
                value: createdRange,
                onChange: setCreatedRange,
                operators: true,
            },
            {
                id: 'status',
                type: 'multi-select',
                label: copy.columns.status,
                value: statusFilter,
                onChange: setStatusFilter,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: EXCHANGE_STATUSES.map((value) => ({ value, label: copy.status[value] })),
            },
            customerListFilter({
                label: copy.columns.customer,
                walkInLabel: t.shared.walkIn,
                value: customerIds,
                onChange: setCustomerIds,
                storeId: branch.apiStoreId,
            }),
            {
                id: 'difference',
                type: 'number',
                label: copy.columns.difference,
                value: differenceFilter,
                onChange: setDifferenceFilter,
                money: true,
            },
            {
                id: 'settlement',
                type: 'multi-select',
                label: copy.columns.settled,
                value: settlementModes,
                onChange: setSettlementModes,
                options: SETTLEMENT_MODES.map((value) => ({ value, label: copy.list.settlementModes[value] })),
                more: true,
            },
        ],
        [copy, t, createdRange, statusFilter, statusExclude, customerIds, branch.apiStoreId, differenceFilter, settlementModes],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const words = copy.list.stats;
        const dash = '—';
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <ArrowLeftRight aria-hidden />,
                label: words.exchanges,
                value: summary ? summary.count.toLocaleString(locale) : dash,
                hint: summary?.cancelledCount ? fmt(words.cancelled, { count: summary.cancelledCount }) : undefined,
            },
            { id: 'returned', icon: <PackageMinus aria-hidden />, label: words.returned, value: summary ? money(summary.returned) : dash },
            {
                id: 'replacement',
                icon: <PackagePlus aria-hidden />,
                label: words.replacement,
                value: summary ? money(summary.replacement) : dash,
            },
            {
                id: 'charged',
                icon: <ArrowDownToLine aria-hidden />,
                label: words.charged,
                value: summary ? money(summary.charged.amount) : dash,
                hint: summary?.charged.count ? fmt(words.exchangesCount, { count: summary.charged.count }) : undefined,
            },
            {
                id: 'refunded',
                icon: <ArrowUpFromLine aria-hidden />,
                label: words.refunded,
                value: summary ? money(summary.refunded.amount) : dash,
                hint: summary?.refunded.count ? fmt(words.exchangesCount, { count: summary.refunded.count }) : undefined,
                tone: summary && summary.refunded.amount > 0 ? 'danger' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: copy.list.statsLabel };
    }, [summary, summaryLoading, locale, copy, fmt]);

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
                        <Link href={routes.sales.exchangeNew} className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {copy.newExchange}
                        </Link>
                    </>
                }
            />

            <DataTable<SalesExchange>
                tableId="sales-exchanges"
                columns={columns}
                data={exchanges}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<ArrowLeftRight className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
                onRowClick={(row) => router.push(routes.sales.exchangeDetail(row.id))}
            />
        </PageShell>
    );
}
