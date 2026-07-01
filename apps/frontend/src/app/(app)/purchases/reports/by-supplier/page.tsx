'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Truck } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

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
    const { t, locale } = useI18n();
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
                header: t.purchaseReports.bySupplier.columns.supplier,
                size: 220,
            }),
            columnHelper.accessor((row) => row.supplier.phone ?? '-', {
                id: 'phone',
                header: t.purchaseReports.bySupplier.columns.phone,
                size: 140,
            }),
            columnHelper.accessor('orderCount', {
                header: t.purchaseReports.bySupplier.columns.orders,
                size: 90,
            }),
            columnHelper.accessor('spend', {
                header: t.purchaseReports.bySupplier.columns.spend,
                cell: (info) => (
                    <span className="font-bold text-blue-700">{formatBDT(Number(info.getValue()), { locale })}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor('avgOrderValue', {
                header: t.purchaseReports.bySupplier.columns.avgOrder,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 130,
            }),
            columnHelper.accessor('spendShare', {
                header: t.purchaseReports.bySupplier.columns.share,
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
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.purchaseReports.bySupplier.title}</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.purchaseReports.bySupplier.subtitle}
                    </p>
                </div>

                <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.bySupplier.totalSpend}</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">
                            {formatBDT(Number(summary?.totalSpend ?? 0), { locale })}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.bySupplier.totalOrders}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.totalOrders ?? 0}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.bySupplier.suppliers}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.supplierCount ?? 0}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.purchaseReports.bySupplier.avgOrder}</div>
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

                <DataTable<SupplierRow>
                    tableId="purchases-by-supplier"
                    columns={columns}
                    data={rows}
                    title={t.purchaseReports.bySupplier.tableTitle}
                    isLoading={loading}
                    emptyMessage={t.purchaseReports.bySupplier.emptyMessage}
                    emptyIcon={<Truck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.purchaseReports.bySupplier.searchPlaceholder}
                />
            </div>
        </div>
    );
}