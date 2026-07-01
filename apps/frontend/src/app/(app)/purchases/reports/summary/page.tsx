'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ShoppingCart } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface SummaryRow {
    date: string;
    orders: number;
    grossPurchases: number;
    returns: number;
    netPurchases: number;
}

interface Summary {
    totalPurchases: number;
    totalReturns: number;
    netPurchases: number;
    orderCount: number;
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

export default function PurchaseSummaryPage() {
    const { t, locale } = useI18n();
    const [rows, setRows] = useState<SummaryRow[]>([]);
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
            const data = await api.getPurchaseSummary({
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (err) {
            console.error('Failed to load purchase summary', err);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<SummaryRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('date', { header: t.purchaseReports.summary.columns.date, size: 130 }),
            columnHelper.accessor('orders', { header: t.purchaseReports.summary.columns.orders, size: 100 }),
            columnHelper.accessor('grossPurchases', {
                header: t.purchaseReports.summary.columns.grossPurchases,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 150,
            }),
            columnHelper.accessor('returns', {
                header: t.purchaseReports.summary.columns.returns,
                cell: (info) => (
                    <span className="text-rose-600">{formatBDT(Number(info.getValue()), { locale })}</span>
                ),
                size: 120,
            }),
            columnHelper.accessor('netPurchases', {
                header: t.purchaseReports.summary.columns.netPurchases,
                cell: (info) => (
                    <span className="font-black text-blue-700">{formatBDT(Number(info.getValue()), { locale })}</span>
                ),
                size: 140,
            }),
        ],
        [t, locale],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.purchaseReports.summary.title}</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.purchaseReports.summary.subtitle}
                    </p>
                </div>

                <div className="grid md:grid-cols-5 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.summary.grossPurchases}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {formatBDT(Number(summary?.totalPurchases ?? 0), { locale })}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.summary.returns}</div>
                        <div className="text-2xl font-black text-rose-600 mt-2">
                            {formatBDT(Number(summary?.totalReturns ?? 0), { locale })}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.summary.netPurchases}</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">
                            {formatBDT(Number(summary?.netPurchases ?? 0), { locale })}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.summary.orders}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.orderCount ?? 0}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.summary.avgOrderValue}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {formatBDT(Number(summary?.avgOrderValue ?? 0), { locale })}
                        </div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{t.accountingShared.from}</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{t.accountingShared.to}</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        />
                    </div>
                </div>

                <DataTable<SummaryRow>
                    tableId="purchase-summary"
                    columns={columns}
                    data={rows}
                    title={t.purchaseReports.summary.dailyBreakdown}
                    isLoading={loading}
                    emptyMessage={t.purchaseReports.summary.emptyMessage}
                    emptyIcon={<ShoppingCart className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.purchaseReports.summary.searchPlaceholder}
                />
            </div>
        </div>
    );
}