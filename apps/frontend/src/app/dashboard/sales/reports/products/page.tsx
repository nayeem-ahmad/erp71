'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Package } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../../lib/api';
import { formatBDT } from '../../../../../lib/format';

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
                header: 'Product',
                size: 240,
            }),
            columnHelper.accessor((row) => row.product.sku ?? '-', {
                id: 'sku',
                header: 'SKU',
                size: 120,
            }),
            columnHelper.accessor((row) => row.product.group?.name ?? 'Uncategorized', {
                id: 'group',
                header: 'Group',
                size: 160,
            }),
            columnHelper.accessor('unitsSold', {
                header: 'Units Sold',
                size: 110,
            }),
            columnHelper.accessor('revenue', {
                header: 'Revenue',
                cell: (info) => formatBDT(Number(info.getValue())),
                size: 130,
            }),
            columnHelper.accessor('revenueShare', {
                header: '% of Total',
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
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Sales by Product</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Units sold and revenue contribution per product over a date range
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Revenue</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">
                            {formatBDT(Number(summary?.totalRevenue ?? 0))}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Units Sold</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.totalUnitsSold ?? 0}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Products Sold</div>
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
                        <option value="">All Groups</option>
                        {groups.map((g: any) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                    <select
                        value={subgroupId}
                        onChange={(e) => setSubgroupId(e.target.value)}
                        className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px]"
                    >
                        <option value="">All Subgroups</option>
                        {filteredSubgroups.map((s: any) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">From</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">To</span>
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
                    title="Product Performance"
                    isLoading={loading}
                    emptyMessage="No sales recorded for this filter"
                    emptyIcon={<Package className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search products..."
                />
            </div>
        </div>
    );
}
