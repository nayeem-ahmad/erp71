'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { TrendingUp } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../../lib/api';
import { formatBDT } from '../../../../../lib/format';

interface SummaryRow {
    date: string;
    transactions: number;
    grossRevenue: number;
    returns: number;
    netRevenue: number;
}

interface Summary {
    totalRevenue: number;
    totalReturns: number;
    netRevenue: number;
    transactionCount: number;
    avgOrderValue: number;
}

const columnHelper = createColumnHelper<SummaryRow>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function SalesSummaryPage() {
    const [rows, setRows] = useState<SummaryRow[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void loadReport();
    }, [fromDate, toDate]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getSalesSummary({
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (error) {
            console.error('Failed to load sales summary', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<SummaryRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('date', { header: 'Date', size: 130 }),
            columnHelper.accessor('transactions', { header: 'Transactions', size: 120 }),
            columnHelper.accessor('grossRevenue', {
                header: 'Gross Revenue',
                cell: (info) => formatBDT(Number(info.getValue())),
                size: 140,
            }),
            columnHelper.accessor('returns', {
                header: 'Returns',
                cell: (info) => (
                    <span className="text-rose-600">{formatBDT(Number(info.getValue()))}</span>
                ),
                size: 120,
            }),
            columnHelper.accessor('netRevenue', {
                header: 'Net Revenue',
                cell: (info) => (
                    <span className="font-black text-blue-700">{formatBDT(Number(info.getValue()))}</span>
                ),
                size: 140,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Sales Summary</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Revenue, returns, and transaction trends over a date range
                    </p>
                </div>

                <div className="grid md:grid-cols-5 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Gross Revenue</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {formatBDT(Number(summary?.totalRevenue ?? 0))}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Returns</div>
                        <div className="text-2xl font-black text-rose-600 mt-2">
                            {formatBDT(Number(summary?.totalReturns ?? 0))}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Net Revenue</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">
                            {formatBDT(Number(summary?.netRevenue ?? 0))}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Transactions</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.transactionCount ?? 0}
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

                <DataTable<SummaryRow>
                    tableId="sales-summary"
                    columns={columns}
                    data={rows}
                    title="Daily Breakdown"
                    isLoading={loading}
                    emptyMessage="No sales recorded in this period"
                    emptyIcon={<TrendingUp className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by date..."
                />
            </div>
        </div>
    );
}
