'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Calculator, Receipt, Sparkles, TrendingUp, Undo2, Wallet, X } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import GroupByChip from '@/components/hr/GroupByChip';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { BranchFilter, Button, PageShell } from '@/components/ui';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery, reportPeriodText } from '../report-period';

interface SummaryRow {
    date: string;
    transactions: number;
    grossRevenue: number;
    returns: number;
    netRevenue: number;
}

type GroupBy = 'day' | 'month';

const columnHelper = createColumnHelper<SummaryRow>();

/** Days rolled up into calendar months; the server sends one row a day. */
function byMonth(rows: SummaryRow[]): SummaryRow[] {
    const months = new Map<string, SummaryRow>();
    for (const row of rows) {
        const key = row.date.slice(0, 7);
        const month = months.get(key) ?? { date: key, transactions: 0, grossRevenue: 0, returns: 0, netRevenue: 0 };
        month.transactions += row.transactions;
        month.grossRevenue += row.grossRevenue;
        month.returns += row.returns;
        month.netRevenue += row.netRevenue;
        months.set(key, month);
    }
    return [...months.values()];
}

function monthLabel(key: string, locale: string): string {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

export default function SalesSummaryPage() {
    const { t, locale } = useI18n();
    const c = t.salesReports.common;
    const ui = t.salesReports.listUi;
    const branch = useBranchScope();
    const [rows, setRows] = useState<SummaryRow[]>([]);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [groupBy, setGroupBy] = useState<GroupBy>('day');
    const [search, setSearch] = useState('');
    const [netFilter, setNetFilter] = useState<NumberCondition | null>(null);
    const [transactionsFilter, setTransactionsFilter] = useState<NumberCondition | null>(null);
    const [withReturns, setWithReturns] = useState(false);
    const [loading, setLoading] = useState(true);
    const [narrating, setNarrating] = useState(false);
    const [narration, setNarration] = useState<string | null>(null);

    useEffect(() => {
        if (!branch.ready) return;
        void loadReport();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, period]);

    const loadReport = async () => {
        setLoading(true);
        setNarration(null);
        try {
            const data = await api.getSalesSummary({ storeId: branch.apiStoreId, ...reportPeriodQuery(period) });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
        } catch (error) {
            setRows([]);
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(error instanceof Error ? error.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    // The server answers a day a row; months are added up here, and the
    // chips other than the period narrow what is left. The strip and the
    // totals row add up the same rows the table shows.
    const visible = useMemo(() => {
        const grouped = groupBy === 'month' ? byMonth(rows) : rows;
        return grouped.filter((row) => {
            if (withReturns && row.returns <= 0) return false;
            if (!matchesNumberCondition(row.netRevenue, netFilter)) return false;
            if (!matchesNumberCondition(row.transactions, transactionsFilter)) return false;
            const label = groupBy === 'month' ? monthLabel(row.date, locale) : row.date;
            return matchesSearch(search, row.date, label);
        });
    }, [rows, groupBy, withReturns, netFilter, transactionsFilter, search, locale]);

    const totals = useMemo(() => {
        const sum = (pick: (row: SummaryRow) => number) => visible.reduce((total, row) => total + pick(row), 0);
        const transactions = sum((row) => row.transactions);
        const grossRevenue = sum((row) => row.grossRevenue);
        return {
            transactions,
            grossRevenue,
            returns: sum((row) => row.returns),
            netRevenue: sum((row) => row.netRevenue),
            avgOrderValue: transactions > 0 ? grossRevenue / transactions : 0,
        };
    }, [visible]);

    const handleNarrate = async () => {
        setNarrating(true);
        try {
            const result = await api.aiNarrateReport({
                reportType: 'sales_summary',
                reportData: {
                    period: reportPeriodText(period),
                    totalRevenue: totals.grossRevenue,
                    totalReturns: totals.returns,
                    netRevenue: totals.netRevenue,
                    transactionCount: totals.transactions,
                    avgOrderValue: totals.avgOrderValue,
                    dailyRows: visible.slice(0, 10),
                },
                locale,
            });
            setNarration(result.narration);
        } catch (error) {
            toast.error(error instanceof Error && error.message ? error.message : ui.aiFailed);
        } finally {
            setNarrating(false);
        }
    };

    const columns: ColumnDef<SummaryRow, any>[] = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale });
        return [
            columnHelper.accessor((row) => (groupBy === 'month' ? monthLabel(row.date, locale) : row.date), {
                id: 'date',
                header: groupBy === 'month' ? ui.groupMonth : c.date,
                footer: () => c.total,
                size: 130,
            }),
            columnHelper.accessor('transactions', {
                header: c.transactions,
                footer: () => totals.transactions.toLocaleString(locale),
                size: 120,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('grossRevenue', {
                header: c.grossRevenue,
                cell: (info) => money(Number(info.getValue())),
                footer: () => money(totals.grossRevenue),
                size: 140,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('returns', {
                header: c.returns,
                cell: (info) => money(Number(info.getValue())),
                footer: () => money(totals.returns),
                size: 120,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('netRevenue', {
                header: c.netRevenue,
                cell: (info) => money(Number(info.getValue())),
                footer: () => money(totals.netRevenue),
                size: 140,
                meta: { align: 'end' },
            }),
        ];
    }, [c, ui, locale, groupBy, totals]);

    const filters = useMemo<ListFilter[]>(
        () => [
            reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod }),
            {
                id: 'net',
                type: 'number',
                label: c.netRevenue,
                value: netFilter,
                onChange: setNetFilter,
                money: true,
            },
            {
                id: 'withReturns',
                type: 'toggle',
                label: ui.withReturns,
                pressed: withReturns,
                onChange: setWithReturns,
                control: 'button',
            },
            {
                id: 'transactions',
                type: 'number',
                label: c.transactions,
                value: transactionsFilter,
                onChange: setTransactionsFilter,
                more: true,
            },
        ],
        [c, ui, period, netFilter, withReturns, transactionsFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'net', icon: <Wallet aria-hidden />, label: c.netRevenue, value: money(totals.netRevenue) },
            { id: 'gross', icon: <TrendingUp aria-hidden />, label: c.grossRevenue, value: money(totals.grossRevenue) },
            {
                id: 'returns',
                icon: <Undo2 aria-hidden />,
                label: c.returns,
                value: money(totals.returns),
                tone: totals.returns > 0 ? 'danger' : 'default',
            },
            {
                id: 'transactions',
                icon: <Receipt aria-hidden />,
                label: c.transactions,
                value: totals.transactions.toLocaleString(locale),
            },
            { id: 'average', icon: <Calculator aria-hidden />, label: c.avgOrderValue, value: money(totals.avgOrderValue) },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [totals, loading, locale, c, ui]);

    return (
        <PageShell>
            <PageHeader
                title={t.salesReports.summary.title}
                subtitle={t.salesReports.summary.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.salesReports.summary.title,
                    'sales',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <Button
                            variant="secondary"
                            onClick={() => void handleNarrate()}
                            disabled={narrating || loading || visible.length === 0}
                            loading={narrating}
                            icon={<Sparkles className="h-4 w-4" />}
                        >
                            {narrating ? ui.aiGenerating : ui.aiNarrate}
                        </Button>
                    </>
                )}
            />

            {narration && (
                <div className="flex gap-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                    <div className="min-w-0 flex-1">
                        <p className="mb-1 text-xs font-semibold text-gray-500">{ui.aiInsight}</p>
                        <p className="text-sm leading-relaxed text-gray-800">{narration}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setNarration(null)}
                        aria-label={ui.dismiss}
                        className="shrink-0 self-start rounded p-1 text-gray-400 hover:text-gray-600 max-md:min-h-touch max-md:min-w-touch"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <DataTable<SummaryRow>
                tableId="sales-summary"
                columns={columns}
                data={visible}
                title={t.salesReports.summary.dailyBreakdown}
                isLoading={loading}
                emptyMessage={c.noSalesInPeriod}
                emptyIcon={<TrendingUp className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.salesReports.summary.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.date}
                toolbarActions={(
                    <GroupByChip<GroupBy>
                        label={ui.groupBy}
                        value={groupBy}
                        onChange={setGroupBy}
                        options={[
                            { value: 'day', label: ui.groupDay },
                            { value: 'month', label: ui.groupMonth },
                        ]}
                    />
                )}
            />
        </PageShell>
    );
}
