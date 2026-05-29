'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

interface CustomerRow {
    customer: {
        id: string | null;
        name: string;
        phone: string | null;
        customer_code: string | null;
    };
    orderCount: number;
    revenue: number;
    avgOrderValue: number;
}

interface Summary {
    totalRevenue: number;
    totalOrders: number;
    customerCount: number;
    avgOrderValue: number;
}

const columnHelper = createColumnHelper<CustomerRow>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function SalesByCustomerPage() {
    const [rows, setRows] = useState<CustomerRow[]>([]);
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
            const data = await api.getSalesByCustomer({
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (err) {
            console.error('Failed to load customer sales', err);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<CustomerRow, any>[] = useMemo(() => [
        columnHelper.accessor((row) => row.customer.name, {
            id: 'customer', header: 'Customer', size: 220,
        }),
        columnHelper.accessor((row) => row.customer.phone ?? '-', {
            id: 'phone', header: 'Phone', size: 140,
        }),
        columnHelper.accessor((row) => row.customer.customer_code ?? '-', {
            id: 'code', header: 'Code', size: 100,
        }),
        columnHelper.accessor('orderCount', {
            header: 'Orders', size: 90,
        }),
        columnHelper.accessor('revenue', {
            header: 'Revenue',
            cell: (info) => <span className="font-bold text-blue-700">{formatBDT(Number(info.getValue()))}</span>,
            size: 140,
        }),
        columnHelper.accessor('avgOrderValue', {
            header: 'Avg Order',
            cell: (info) => formatBDT(Number(info.getValue())),
            size: 130,
        }),
    ], []);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Customer-wise Sales Summary</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Revenue and order volume per customer over a date range
                    </p>
                </div>

                <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Revenue</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">{formatBDT(Number(summary?.totalRevenue ?? 0))}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Orders</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{summary?.totalOrders ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Customers</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{summary?.customerCount ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Avg Order Value</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{formatBDT(Number(summary?.avgOrderValue ?? 0))}</div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">From</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">To</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                </div>

                <DataTable<CustomerRow>
                    tableId="sales-by-customer"
                    columns={columns}
                    data={rows}
                    title="Customer Performance"
                    isLoading={loading}
                    emptyMessage="No sales recorded in this period"
                    emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search customers..."
                />
            </div>
        </div>
    );
}
