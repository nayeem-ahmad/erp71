'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Truck } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

interface SupplierRow {
    supplier: {
        id: string | null;
        name: string;
        phone: string | null;
    };
    orderCount: number;
    spend: number;
    avgOrderValue: number;
    spendShare: number;
}

interface Summary {
    totalSpend: number;
    totalOrders: number;
    supplierCount: number;
    avgOrderValue: number;
}

const columnHelper = createColumnHelper<SupplierRow>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function PurchasesBySupplierPage() {
    const [rows, setRows] = useState<SupplierRow[]>([]);
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
            const data = await api.getPurchasesBySupplier({
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (err) {
            console.error('Failed to load purchases by supplier', err);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<SupplierRow, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.supplier.name, {
                id: 'supplier',
                header: 'Supplier',
                size: 220,
            }),
            columnHelper.accessor((row) => row.supplier.phone ?? '-', {
                id: 'phone',
                header: 'Phone',
                size: 140,
            }),
            columnHelper.accessor('orderCount', {
                header: 'Orders',
                size: 90,
            }),
            columnHelper.accessor('spend', {
                header: 'Total Spend',
                cell: (info) => (
                    <span className="font-bold text-blue-700">{formatBDT(Number(info.getValue()))}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor('avgOrderValue', {
                header: 'Avg Order',
                cell: (info) => formatBDT(Number(info.getValue())),
                size: 130,
            }),
            columnHelper.accessor('spendShare', {
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
                    <h1 className="text-2xl font-black tracking-tight">Purchases by Supplier</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Spend and order volume per supplier over a date range
                    </p>
                </div>

                <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Spend</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">
                            {formatBDT(Number(summary?.totalSpend ?? 0))}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Orders</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.totalOrders ?? 0}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Suppliers</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.supplierCount ?? 0}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Avg Order Value</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {formatBDT(Number(summary?.avgOrderValue ?? 0))}
                        </div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
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

                <DataTable<SupplierRow>
                    tableId="purchases-by-supplier"
                    columns={columns}
                    data={rows}
                    title="Supplier Performance"
                    isLoading={loading}
                    emptyMessage="No purchases recorded in this period"
                    emptyIcon={<Truck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search suppliers..."
                />
            </div>
        </div>
    );
}
