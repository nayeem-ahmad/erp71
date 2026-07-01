'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

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
    const { t, locale } = useI18n();
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
            id: 'customer', header: t.salesReports.common.customer, size: 220,
        }),
        columnHelper.accessor((row) => row.customer.phone ?? t.shared.dash, {
            id: 'phone', header: t.salesReports.common.phone, size: 140,
        }),
        columnHelper.accessor((row) => row.customer.customer_code ?? t.shared.dash, {
            id: 'code', header: t.salesReports.common.code, size: 100,
        }),
        columnHelper.accessor('orderCount', {
            header: t.salesReports.common.orders, size: 90,
        }),
        columnHelper.accessor('revenue', {
            header: t.salesReports.common.revenue,
            cell: (info) => <span className="font-bold text-blue-700">{formatBDT(Number(info.getValue()), { locale })}</span>,
            size: 140,
        }),
        columnHelper.accessor('avgOrderValue', {
            header: t.salesReports.common.avgOrder,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            size: 130,
        }),
    ], [t, locale]);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.salesReports.customers.title}</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.salesReports.customers.subtitle}
                    </p>
                </div>

                <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.totalRevenue}</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">{formatBDT(Number(summary?.totalRevenue ?? 0), { locale })}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.totalOrders}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{summary?.totalOrders ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.customers}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{summary?.customerCount ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.avgOrderValue}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{formatBDT(Number(summary?.avgOrderValue ?? 0), { locale })}</div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{t.salesReports.common.from}</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{t.salesReports.common.to}</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                </div>

                <DataTable<CustomerRow>
                    tableId="sales-by-customer"
                    columns={columns}
                    data={rows}
                    title={t.salesReports.customers.customerPerformance}
                    isLoading={loading}
                    emptyMessage={t.salesReports.common.noSalesInPeriod}
                    emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.salesReports.customers.searchPlaceholder}
                />
            </div>
        </div>
    );
}