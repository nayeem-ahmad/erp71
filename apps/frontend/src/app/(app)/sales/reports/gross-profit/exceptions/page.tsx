'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle } from 'lucide-react';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';
import { MarginCell, ProfitCell, StatTile } from '@/components/gross-profit';

interface Row {
    saleId: string;
    saleDate: string;
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    soldBelowCost: boolean;
}

interface UserRow {
    userId: string | null;
    userName: string;
    lines: number;
    marginForgone: number;
}

interface Summary {
    marginFloorPct: number;
    exceptionCount: number;
    belowCostCount: number;
    exceptionRevenue: number;
    marginForgone: number;
    uncostedLines: number;
    truncated: boolean;
}

const columnHelper = createColumnHelper<Row>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

export default function MarginExceptionsPage() {
    const { t, locale } = useI18n();
    const gp = t.salesReports.grossProfit;
    const [rows, setRows] = useState<Row[]>([]);
    const [byUser, setByUser] = useState<UserRow[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
    const [floor, setFloor] = useState('0');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
    }, [fromDate, toDate, floor]);

    const load = async () => {
        setLoading(true);
        try {
            const parsed = Number(floor);
            const data = await api.getMarginExceptions({
                from: fromDate,
                to: toDate,
                marginFloorPct: Number.isFinite(parsed) ? parsed : 0,
            });
            setSummary(data.summary);
            setRows(data.rows);
            setByUser(data.byUser);
        } catch (error) {
            console.error('Failed to load margin exceptions', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<Row, any>[] = useMemo(
        () => [
            columnHelper.accessor('productName', { header: gp.product, size: 220 }),
            columnHelper.accessor('saleDate', {
                header: gp.date,
                cell: (info) => String(info.getValue()).slice(0, 10),
                size: 110,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('quantity', { header: gp.qty, size: 70 }),
            columnHelper.accessor('revenue', {
                header: gp.revenue,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 120,
            }),
            columnHelper.accessor('cogs', {
                header: gp.cogs,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('grossProfit', {
                header: gp.grossProfit,
                cell: (info) => <ProfitCell value={info.getValue()} locale={locale} dash={t.shared.dash} />,
                size: 120,
            }),
            columnHelper.accessor('grossMarginPct', {
                header: gp.margin,
                cell: (info) => <MarginCell value={info.getValue()} dash={t.shared.dash} />,
                size: 100,
            }),
        ],
        [t, locale, gp],
    );

    return (
        <PageShell>
            <PageHeader
                title={gp.exceptionsTitle}
                subtitle={gp.exceptionsSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    gp.exceptionsTitle,
                    'sales',
                )}
            />

            <div className="grid md:grid-cols-4 gap-4">
                <StatTile label={gp.exceptionLines}>{summary?.exceptionCount ?? 0}</StatTile>
                <StatTile label={gp.belowCostLines} tone={(summary?.belowCostCount ?? 0) > 0 ? 'danger' : 'default'}>
                    {summary?.belowCostCount ?? 0}
                </StatTile>
                <StatTile label={gp.affectedRevenue}>
                    {formatBDT(summary?.exceptionRevenue ?? 0, { locale })}
                </StatTile>
                <StatTile label={gp.marginForgone} tone="danger">
                    {formatBDT(summary?.marginForgone ?? 0, { locale })}
                </StatTile>
            </div>

            {summary && summary.uncostedLines > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{gp.exceptionsUncosted.replace('{lines}', String(summary.uncostedLines))}</span>
                </div>
            ) : null}

            {summary?.truncated ? (
                <div className="rounded-lg border border-gray-100 bg-white px-4 py-2.5 text-xs text-gray-500">
                    {gp.exceptionsTruncated
                        .replace('{shown}', String(rows.length))
                        .replace('{total}', String(summary.exceptionCount))}
                </div>
            ) : null}

            <div className="bg-white border border-gray-100 rounded-lg p-4 flex flex-wrap gap-3 items-end">
                <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                />
                <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                />
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1" htmlFor="margin-floor">
                        {gp.marginFloor}
                    </label>
                    <input
                        id="margin-floor"
                        type="number"
                        value={floor}
                        min={-100}
                        max={100}
                        onChange={(e) => setFloor(e.target.value)}
                        className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch w-32"
                    />
                </div>
            </div>

            {byUser.length > 0 ? (
                <div className="bg-white border border-gray-100 rounded-lg p-4 space-y-3">
                    <h2 className="text-sm font-bold text-gray-700">{gp.byWhoRangItUp}</h2>
                    <div className="grid gap-2">
                        {byUser.map((user) => (
                            <div
                                key={user.userId ?? 'unattributed'}
                                className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5 text-sm"
                            >
                                <span className="font-medium text-gray-700">{user.userName}</span>
                                <span className="text-xs text-gray-500">
                                    {gp.linesCount.replace('{count}', String(user.lines))} ·{' '}
                                    <span className="font-semibold text-red-600">
                                        {formatBDT(user.marginForgone, { locale })}
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <DataTable<Row>
                tableId="margin-exceptions"
                columns={columns}
                data={rows}
                title={gp.exceptionsTitle}
                isLoading={loading}
                emptyMessage={gp.exceptionsEmpty}
                emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={gp.searchProducts}
            />
        </PageShell>
    );
}
