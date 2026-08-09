'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Package } from 'lucide-react';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';
import { CoverageNotice, MarginCell, ProfitCell, StatTile, type Coverage } from '@/components/gross-profit';

interface Row {
    productId: string;
    productName: string;
    unitsSold: number;
    revenue: number;
    cogs: number;
    grossProfit: number | null;
    grossMarginPct: number | null;
    coverage: Coverage;
}

interface Summary {
    netRevenue: number;
    cogs: number;
    grossProfit: number | null;
    grossMarginPct: number | null;
    coverage: Coverage;
}

const columnHelper = createColumnHelper<Row>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function GrossProfitByProductPage() {
    const { t, locale } = useI18n();
    const gp = t.salesReports.grossProfit;
    const [rows, setRows] = useState<Row[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
    }, [fromDate, toDate]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getGrossProfitByProduct({ from: fromDate, to: toDate });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (error) {
            console.error('Failed to load gross profit by product', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<Row, any>[] = useMemo(
        () => [
            columnHelper.accessor('productName', { header: gp.product, size: 240 }),
            columnHelper.accessor('unitsSold', { header: gp.units, size: 90 }),
            columnHelper.accessor('revenue', {
                header: gp.revenue,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 130,
            }),
            columnHelper.accessor('cogs', {
                header: gp.cogs,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 130,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('grossProfit', {
                header: gp.grossProfit,
                cell: (info) => <ProfitCell value={info.getValue()} locale={locale} dash={t.shared.dash} />,
                size: 130,
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
                title={gp.byProductTitle}
                subtitle={gp.byProductSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    gp.byProductTitle,
                    'sales',
                )}
            />

            <div className="flex flex-wrap gap-2 text-xs">
                <Link href={routes.sales.reports.grossProfitSalespeople} className="text-blue-600 hover:underline">
                    {gp.bySalespersonTitle}
                </Link>
                <span className="text-gray-300">·</span>
                <Link href={routes.sales.reports.grossProfitExceptions} className="text-blue-600 hover:underline">
                    {gp.exceptionsTitle}
                </Link>
                <span className="text-gray-300">·</span>
                <Link href={routes.sales.reports.grossProfitBridge} className="text-blue-600 hover:underline">
                    {gp.bridgeTitle}
                </Link>
                <span className="text-gray-300">·</span>
                <Link href={routes.sales.reports.grossProfitCoverage} className="text-blue-600 hover:underline">
                    {gp.coverageTitle}
                </Link>
            </div>

            <div className="grid md:grid-cols-4 gap-4">
                <StatTile label={gp.revenue} tone="primary">
                    {formatBDT(summary?.netRevenue ?? 0, { locale })}
                </StatTile>
                <StatTile label={gp.cogs}>{formatBDT(summary?.cogs ?? 0, { locale })}</StatTile>
                <StatTile label={gp.grossProfit} tone={(summary?.grossProfit ?? 0) < 0 ? 'danger' : 'default'}>
                    <ProfitCell value={summary?.grossProfit} locale={locale} dash={t.shared.dash} />
                </StatTile>
                <StatTile label={gp.margin}>
                    <MarginCell value={summary?.grossMarginPct} dash={t.shared.dash} />
                </StatTile>
            </div>

            <CoverageNotice
                coverage={summary?.coverage}
                locale={locale}
                labels={{
                    full: gp.coverageFull,
                    partial: gp.coveragePartial,
                    none: gp.coverageNone,
                    fixLink: gp.coverageFix,
                }}
            />

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
            </div>

            <DataTable<Row>
                tableId="gross-profit-by-product"
                columns={columns}
                data={rows}
                title={gp.byProductTitle}
                isLoading={loading}
                emptyMessage={gp.empty}
                emptyIcon={<Package className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={gp.searchProducts}
            />
        </PageShell>
    );
}
