'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Package } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface ProductRow {
    product: {
        id: string;
        name: string;
        sku?: string | null;
        group?: { name: string } | null;
        subgroup?: { name: string } | null;
    };
    unitsSold: number;
    revenue: number;
    revenueShare: number;
}

interface Summary {
    totalRevenue: number;
    totalUnitsSold: number;
    productCount: number;
}

const columnHelper = createColumnHelper<ProductRow>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function SalesByProductPage() {
    const { t, locale } = useI18n();
    const [rows, setRows] = useState<ProductRow[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void Promise.all([loadReport(), loadFilters()]);
    }, []);

    useEffect(() => {
        void loadReport();
    }, [groupId, subgroupId, fromDate, toDate]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getSalesByProduct({
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (error) {
            console.error('Failed to load sales by product', error);
        } finally {
            setLoading(false);
        }
    };

    const loadFilters = async () => {
        try {
            const [groupData, subgroupData] = await Promise.all([
                api.getProductGroups(),
                api.getProductSubgroups(),
            ]);
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error('Failed to load filters', error);
        }
    };

    const filteredSubgroups = useMemo(
        () => subgroups.filter((s: any) => !groupId || s.group_id === groupId),
        [subgroups, groupId],
    );

    const columns: ColumnDef<ProductRow, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.product.name, {
                id: 'product',
                header: t.salesReports.common.product,
                size: 240,
            }),
            columnHelper.accessor((row) => row.product.sku ?? t.shared.dash, {
                id: 'sku',
                header: t.salesReports.common.sku,
                size: 120,
            }),
            columnHelper.accessor((row) => row.product.group?.name ?? t.salesReports.common.uncategorized, {
                id: 'group',
                header: t.salesReports.common.group,
                size: 160,
            }),
            columnHelper.accessor('unitsSold', {
                header: t.salesReports.common.unitsSoldCol,
                size: 110,
            }),
            columnHelper.accessor('revenue', {
                header: t.salesReports.common.revenue,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 130,
            }),
            columnHelper.accessor('revenueShare', {
                header: t.salesReports.common.percentOfTotal,
                cell: (info) => (
                    <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                            <div
                                className="bg-blue-500 h-1.5 rounded-full"
                                style={{ width: `${Math.min(info.getValue(), 100)}%` }}
                            />
                        </div>
                        <span className="text-xs font-bold text-gray-600 w-12 text-right">
                            {Number(info.getValue()).toFixed(1)}%
                        </span>
                    </div>
                ),
                size: 180,
            }),
        ],
        [t, locale],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.salesReports.products.title}</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.salesReports.products.subtitle}
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.totalRevenue}</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">
                            {formatBDT(Number(summary?.totalRevenue ?? 0), { locale })}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.unitsSold}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.totalUnitsSold ?? 0}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.productsSold}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.productCount ?? 0}
                        </div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <select
                        value={groupId}
                        onChange={(e) => { setGroupId(e.target.value); setSubgroupId(''); }}
                        className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px]"
                    >
                        <option value="">{t.salesReports.common.allGroups}</option>
                        {groups.map((g: any) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                    <select
                        value={subgroupId}
                        onChange={(e) => setSubgroupId(e.target.value)}
                        className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px]"
                    >
                        <option value="">{t.salesReports.common.allSubgroups}</option>
                        {filteredSubgroups.map((s: any) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{t.salesReports.common.from}</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{t.salesReports.common.to}</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        />
                    </div>
                </div>

                <DataTable<ProductRow>
                    tableId="sales-by-product"
                    columns={columns}
                    data={rows}
                    title={t.salesReports.products.productPerformance}
                    isLoading={loading}
                    emptyMessage={t.salesReports.common.noSalesForFilter}
                    emptyIcon={<Package className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.salesReports.products.searchPlaceholder}
                />
            </div>
        </div>
    );
}