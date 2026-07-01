'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { resolveLocaleForFormatting } from '@/lib/format';

interface MonthlyRow {
    customer: { id: string | null; name: string; phone: string | null };
    total: number;
    monthly: Array<{ month: string; revenue: number; orderCount: number }>;
}

interface MonthlyData {
    months: string[];
    rows: MonthlyRow[];
}

function formatMonth(m: string, locale: string) {
    const [year, month] = m.split('-');
    const d = new Date(Number(year), Number(month) - 1, 1);
    const resolved = resolveLocaleForFormatting(locale);
    const config = resolved === 'bn' ? 'bn-BD' : resolved === 'ms' ? 'ms-MY' : 'en-US';
    return d.toLocaleDateString(config, { month: 'short', year: '2-digit' });
}

function defaultFrom() {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function MonthlySalesPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<MonthlyData | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, [fromDate, toDate]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getMonthlySalesByCustomer({
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? t.shared.errors.loadReport);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-[1600px] mx-auto space-y-6">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.salesReports.monthly.title}</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.salesReports.monthly.subtitle}
                    </p>
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

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                {loading ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400 text-sm font-medium">{t.shared.loading.generic}</div>
                ) : data && data.rows.length === 0 ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-12 flex flex-col items-center gap-3 text-gray-400">
                        <BarChart3 className="w-16 h-16 text-gray-200" />
                        <p className="text-sm font-medium">{t.salesReports.common.noSalesInPeriod}</p>
                    </div>
                ) : data ? (
                    <div className="bg-white border border-gray-100 rounded-2xl overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-400 sticky left-0 bg-white min-w-[200px]">
                                        {t.salesReports.common.customer}
                                    </th>
                                    {data.months.map((m) => (
                                        <th key={m} className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-400 whitespace-nowrap min-w-[120px]">
                                            {formatMonth(m, locale)}
                                        </th>
                                    ))}
                                    <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-400 whitespace-nowrap min-w-[130px] bg-gray-50">
                                        {t.salesReports.common.total}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row, i) => (
                                    <tr key={row.customer.id ?? `walkin-${i}`} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="px-4 py-3 sticky left-0 bg-white">
                                            <div className="font-bold text-gray-900">{row.customer.name}</div>
                                            {row.customer.phone && (
                                                <div className="text-xs text-gray-400 mt-0.5">{row.customer.phone}</div>
                                            )}
                                        </td>
                                        {row.monthly.map((m) => (
                                            <td key={m.month} className="px-4 py-3 text-right">
                                                {m.revenue > 0 ? (
                                                    <div>
                                                        <div className="font-bold text-gray-900">{formatBDT(m.revenue, { locale })}</div>
                                                        <div className="text-xs text-gray-400">
                                                            {m.orderCount === 1
                                                                ? formatMessage(t.shared.orderCount, { count: m.orderCount })
                                                                : formatMessage(t.shared.orderCountPlural, { count: m.orderCount })}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-200">{t.shared.dash}</span>
                                                )}
                                            </td>
                                        ))}
                                        <td className="px-4 py-3 text-right bg-gray-50">
                                            <span className="font-black text-blue-700">{formatBDT(row.total, { locale })}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-gray-200 bg-gray-50">
                                    <td className="px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500 sticky left-0 bg-gray-50">
                                        {t.salesReports.common.total}
                                    </td>
                                    {data.months.map((m) => {
                                        const colTotal = data.rows.reduce((sum, row) => {
                                            const monthData = row.monthly.find((x) => x.month === m);
                                            return sum + (monthData?.revenue ?? 0);
                                        }, 0);
                                        return (
                                            <td key={m} className="px-4 py-3 text-right font-black text-gray-800">
                                                {formatBDT(colTotal, { locale })}
                                            </td>
                                        );
                                    })}
                                    <td className="px-4 py-3 text-right font-black text-blue-700">
                                        {formatBDT(data.rows.reduce((sum, r) => sum + r.total, 0), { locale })}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                ) : null}
            </div>
        </div>
    );
}