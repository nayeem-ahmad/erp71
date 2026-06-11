'use client';

import { useState, useEffect } from 'react';
import { Clock, RefreshCw, AlertTriangle, Download } from 'lucide-react';
import { api } from '../../../../../lib/api';
import { formatBDT } from '../../../../../lib/format';
import Link from 'next/link';

interface AgingRow {
    customer: { id: string; name: string; phone: string };
    bucket_0_30: number;
    bucket_31_60: number;
    bucket_61_90: number;
    bucket_90_plus: number;
    total: number;
}

export default function DueAgingReportPage() {
    const [rows, setRows] = useState<AgingRow[]>([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getDueAgingReport();
            setRows(Array.isArray(data) ? data : []);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void load(); }, []);

    const totals = rows.reduce(
        (acc, r) => ({
            b0_30: acc.b0_30 + r.bucket_0_30,
            b31_60: acc.b31_60 + r.bucket_31_60,
            b61_90: acc.b61_90 + r.bucket_61_90,
            b90plus: acc.b90plus + r.bucket_90_plus,
            total: acc.total + r.total,
        }),
        { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0 },
    );

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Clock className="w-6 h-6 text-amber-600" /> Due Aging Report
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">Customer credit balances bucketed by age of debt</p>
                </div>
                <button onClick={load} className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
                    <RefreshCw className="w-4 h-4" /> Refresh
                </button>
            </div>

            {/* Summary cards */}
            {!loading && rows.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                    {[
                        { label: '0–30 days', value: totals.b0_30, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                        { label: '31–60 days', value: totals.b31_60, color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
                        { label: '61–90 days', value: totals.b61_90, color: 'bg-orange-50 border-orange-200 text-orange-700' },
                        { label: '90+ days', value: totals.b90plus, color: 'bg-rose-50 border-rose-200 text-rose-700' },
                        { label: 'Total Due', value: totals.total, color: 'bg-gray-50 border-gray-200 text-gray-800' },
                    ].map(({ label, value, color }) => (
                        <div key={label} className={`rounded-xl border p-4 ${color}`}>
                            <p className="text-xs font-bold uppercase tracking-widest opacity-70 mb-1">{label}</p>
                            <p className="text-xl font-black">{formatBDT(value)}</p>
                        </div>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="py-16 text-center text-gray-400 text-sm uppercase tracking-widest">Loading...</div>
            ) : rows.length === 0 ? (
                <div className="py-20 text-center">
                    <Clock className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                    <p className="text-gray-400 font-medium">No outstanding dues</p>
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                            <tr>
                                <th className="text-left px-4 py-3">Customer</th>
                                <th className="text-right px-4 py-3">0–30 days</th>
                                <th className="text-right px-4 py-3">31–60 days</th>
                                <th className="text-right px-4 py-3">61–90 days</th>
                                <th className="text-right px-4 py-3">90+ days</th>
                                <th className="text-right px-4 py-3 text-gray-700">Total Due</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {rows.map((row) => (
                                <tr key={row.customer.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <Link href={`/dashboard/customers/${row.customer.id}`} className="hover:text-blue-600">
                                            <div className="font-medium text-gray-900">{row.customer.name}</div>
                                            <div className="text-xs text-gray-400">{row.customer.phone}</div>
                                        </Link>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {row.bucket_0_30 > 0 ? <span className="text-emerald-700 font-medium">{formatBDT(row.bucket_0_30)}</span> : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {row.bucket_31_60 > 0 ? <span className="text-yellow-700 font-medium">{formatBDT(row.bucket_31_60)}</span> : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {row.bucket_61_90 > 0 ? <span className="text-orange-700 font-medium">{formatBDT(row.bucket_61_90)}</span> : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {row.bucket_90_plus > 0 ? (
                                            <span className="flex items-center justify-end gap-1 text-rose-600 font-bold">
                                                <AlertTriangle className="w-3 h-3" />{formatBDT(row.bucket_90_plus)}
                                            </span>
                                        ) : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-gray-900">{formatBDT(row.total)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t border-gray-200 font-bold text-gray-700">
                            <tr>
                                <td className="px-4 py-3 text-xs uppercase tracking-wider">Total ({rows.length} customers)</td>
                                <td className="px-4 py-3 text-right">{formatBDT(totals.b0_30)}</td>
                                <td className="px-4 py-3 text-right">{formatBDT(totals.b31_60)}</td>
                                <td className="px-4 py-3 text-right">{formatBDT(totals.b61_90)}</td>
                                <td className="px-4 py-3 text-right text-rose-600">{formatBDT(totals.b90plus)}</td>
                                <td className="px-4 py-3 text-right">{formatBDT(totals.total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}
