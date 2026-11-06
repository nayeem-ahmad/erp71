'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, CircleSlash, Hourglass, ListChecks, RefreshCw } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { applyDateRangeQuery, type CreatedRange } from '@/lib/created-range';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

const STATUSES = ['pending', 'failed', 'posted', 'skipped'] as const;
type PostingStatus = (typeof STATUSES)[number];

const STATUS_TONE: Record<PostingStatus, StatusBadgeTone> = {
    posted: 'success',
    pending: 'warning',
    failed: 'danger',
    skipped: 'neutral',
};

/** The modules that queue posting events; the server filters on one of them. */
const MODULES = [
    'accounting',
    'cashier-sessions',
    'customers',
    'expenses',
    'external-sync',
    'fund-transfers',
    'fund_transfers',
    'imports',
    'inventory',
    'investors',
    'loans',
    'payroll',
    'purchase-orders',
    'purchases',
    'salary-payments',
    'sales',
    'suppliers',
    'warehouse_transfers',
] as const;

interface PostingEvent {
    id: string;
    eventType: string;
    sourceModule: string;
    sourceType: string;
    sourceId: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    lastAttemptAt: string | null;
    voucher: {
        id: string;
        voucher_number: string;
        voucher_type: string;
    } | null;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
}

const columnHelper = createColumnHelper<PostingEvent>();

/** "inventory_adjustment" → "Inventory adjustment", for an event type with no label of its own. */
function humanize(code: string): string {
    const words = code.replace(/[_-]+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

export default function PostingExceptionsPage() {
    const { t, locale } = useI18n();
    const pe = t.postingExceptions;
    const ui = t.accountingFinanceUi.postingExceptions;
    const statusLabels = t.accountingShared.postingStatus;
    const eventLabels = t.accountingShared.eventTypes;
    const [events, setEvents] = useState<PostingEvent[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0 });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<string | null>(null);
    const [filterModule, setFilterModule] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState<CreatedRange | null>(null);
    const [counts, setCounts] = useState<Record<PostingStatus, number> | null>(null);
    const [countsLoading, setCountsLoading] = useState(true);
    const [retryingId, setRetryingId] = useState<string | null>(null);

    const scope = useMemo(() => {
        const range = applyDateRangeQuery(dateRange);
        return { module: filterModule || undefined, from: range.dateFrom, to: range.dateTo };
    }, [filterModule, dateRange]);

    const loadEvents = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getPostingExceptions({
                status: filterStatus || undefined,
                ...scope,
                page,
                limit: pageSize,
            });
            setEvents(data?.data ?? []);
            setPagination(data?.pagination ?? { page: 1, limit: pageSize, total: 0 });
        } catch (err) {
            console.error('Failed to load posting exceptions', err);
            toast.error(err instanceof Error && err.message ? err.message : t.accountingShared.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [filterStatus, scope, page, pageSize, t]);

    // The strip counts each status over the module and date chips: one
    // one-row request per status, read for its total.
    const loadCounts = useCallback(async () => {
        setCountsLoading(true);
        try {
            const totals = await Promise.all(
                STATUSES.map((status) =>
                    api.getPostingExceptions({ status, ...scope, page: 1, limit: 1 })
                        .then((data: { pagination?: Pagination } | null) => Number(data?.pagination?.total ?? 0))
                        .catch(() => 0),
                ),
            );
            setCounts(Object.fromEntries(STATUSES.map((status, i) => [status, totals[i]])) as Record<PostingStatus, number>);
        } finally {
            setCountsLoading(false);
        }
    }, [scope]);

    useEffect(() => {
        void loadEvents();
    }, [loadEvents]);

    useEffect(() => {
        void loadCounts();
    }, [loadCounts]);

    const refresh = () => {
        void loadEvents();
        void loadCounts();
    };

    const handleRetry = async (id: string) => {
        setRetryingId(id);
        try {
            const result = await api.retryPostingException(id);
            toast.success(result?.message ?? pe.retryQueued);
            refresh();
        } catch (err: any) {
            toast.error(err?.message ?? pe.retryFailed);
        } finally {
            setRetryingId(null);
        }
    };

    const statusLabel = (status: string) => statusLabels[status as PostingStatus] ?? status;
    const eventLabel = (type: string) => eventLabels[type as keyof typeof eventLabels] ?? humanize(type);

    const moduleOptions = useMemo(() => {
        const known = new Set<string>(MODULES);
        for (const event of events) known.add(event.sourceModule);
        if (filterModule) known.add(filterModule);
        return [...known].sort().map((value) => ({ value, label: value }));
    }, [events, filterModule]);

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'status',
                type: 'select',
                label: t.accountingShared.status,
                value: filterStatus,
                onChange: (next) => { setFilterStatus(next); setPage(1); },
                options: STATUSES.map((value) => ({ value, label: statusLabel(value) })),
            },
            {
                id: 'module',
                type: 'select',
                label: pe.columns.module,
                value: filterModule,
                onChange: (next) => { setFilterModule(next); setPage(1); },
                options: moduleOptions,
            },
            {
                id: 'updated',
                type: 'date-range',
                label: ui.lastActivity,
                value: dateRange,
                onChange: (next) => { setDateRange(next); setPage(1); },
                operators: true,
            },
        ],
        [t, pe, ui, filterStatus, filterModule, moduleOptions, dateRange],
    );

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        // With a status chosen, the other statuses have no rows in the list.
        const countOf = (status: PostingStatus) => (filterStatus && filterStatus !== status ? 0 : counts?.[status] ?? 0);
        const total = STATUSES.reduce((sum, status) => sum + countOf(status), 0);
        const items: ListStat[] = [
            { id: 'count', icon: <ListChecks aria-hidden />, label: t.accountingShared.postingEvents, value: n(total) },
            {
                id: 'pending',
                icon: <Hourglass aria-hidden />,
                label: statusLabels.pending,
                value: n(countOf('pending')),
                tone: countOf('pending') > 0 ? 'warning' : 'default',
            },
            {
                id: 'failed',
                icon: <CircleAlert aria-hidden />,
                label: statusLabels.failed,
                value: n(countOf('failed')),
                tone: countOf('failed') > 0 ? 'danger' : 'default',
            },
            { id: 'posted', icon: <CircleCheck aria-hidden />, label: statusLabels.posted, value: n(countOf('posted')) },
            { id: 'skipped', icon: <CircleSlash aria-hidden />, label: statusLabels.skipped, value: n(countOf('skipped')) },
        ];
        return { items, loading: countsLoading && !counts, label: ui.statsLabel };
    }, [counts, countsLoading, filterStatus, locale, statusLabels, t, ui]);

    const columns = useMemo<ColumnDef<PostingEvent, any>[]>(
        () => [
            columnHelper.accessor('eventType', {
                header: pe.columns.event,
                cell: (info) => eventLabel(info.getValue()),
                enableSorting: false,
                size: 170,
            }),
            columnHelper.accessor('sourceModule', {
                header: pe.columns.module,
                cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
                enableSorting: false,
                meta: { hideOnMobile: true },
                size: 130,
            }),
            columnHelper.accessor('sourceId', {
                header: pe.columns.source,
                cell: (info) => (
                    <div className="min-w-0">
                        <span className="block text-xs text-gray-500">{info.row.original.sourceType}</span>
                        <span className="block font-mono text-xs truncate max-w-[120px]" title={info.getValue()}>
                            {info.getValue()}
                        </span>
                    </div>
                ),
                enableSorting: false,
                meta: { hideOnMobile: true },
                size: 150,
            }),
            columnHelper.accessor('status', {
                header: t.accountingShared.status,
                cell: (info) => (
                    <StatusBadge tone={STATUS_TONE[info.getValue() as PostingStatus] ?? 'neutral'}>
                        {statusLabel(info.getValue())}
                    </StatusBadge>
                ),
                enableSorting: false,
                size: 100,
            }),
            columnHelper.accessor('attemptCount', {
                header: pe.columns.attempts,
                cell: (info) => Number(info.getValue() ?? 0).toLocaleString(locale),
                enableSorting: false,
                meta: { align: 'end', hideOnMobile: true },
                size: 90,
            }),
            columnHelper.accessor('lastError', {
                header: pe.columns.lastError,
                cell: (info) => {
                    const err = info.getValue();
                    return err ? (
                        <span className="text-xs text-red-600 font-mono" title={err}>
                            {err.length > 40 ? `${err.slice(0, 40)}…` : err}
                        </span>
                    ) : '—';
                },
                enableSorting: false,
                size: 220,
            }),
            columnHelper.display({
                id: 'voucher',
                header: pe.columns.voucher,
                cell: ({ row }) => row.original.voucher?.voucher_number
                    ? <span className="font-mono text-xs">{row.original.voucher.voucher_number}</span>
                    : '—',
                meta: { hideOnMobile: true },
                size: 120,
            }),
            columnHelper.accessor('lastAttemptAt', {
                header: pe.columns.lastAttempt,
                cell: (info) => (info.getValue() ? formatDateTime(info.getValue() as string, locale) : '—'),
                enableSorting: false,
                meta: { hideOnMobile: true },
                size: 150,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => {
                    const event = row.original;
                    if (event.status === 'posted' || event.status === 'skipped') return null;
                    const isRetrying = retryingId === event.id;
                    return (
                        <RowActions>
                            <RowActionButton
                                icon={<RefreshCw className={isRetrying ? 'animate-spin' : undefined} />}
                                label={isRetrying ? pe.retrying : pe.retry}
                                disabled={isRetrying}
                                onClick={() => void handleRetry(event.id)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 80,
            }),
        ],
        [t, pe, locale, retryingId],
    );

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={pe.title}
                subtitle={pe.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    pe.title,
                    'accounting',
                )}
                actions={(
                    <Button variant="secondary" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={refresh}>
                        {t.common.refresh}
                    </Button>
                )}
            />

            <DataTable
                tableId="posting-exceptions"
                title={t.accountingShared.postingEvents}
                columns={columns}
                data={events}
                isLoading={loading}
                showSearch={false}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                emptyMessage={t.common.noData}
                emptyIcon={<ListChecks className="w-16 h-16 text-gray-200" />}
                serverPagination={{
                    total: pagination.total,
                    page,
                    pageSize,
                    onPageChange: setPage,
                    onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
                    sort: null,
                    onSortChange: () => undefined,
                }}
            />
        </AccountingPageShell>
    );
}
