'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface Account { id: string; name: string; code?: string | null; type: string; }
interface EntryRow { accountId: string; debitAmount: string; creditAmount: string; }

function today() { return new Date().toISOString().slice(0, 10); }

export default function OpeningBalancesPage() {
    const { t, locale } = useI18n();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [asOfDate, setAsOfDate] = useState(today());
    const [rows, setRows] = useState<EntryRow[]>([
        { accountId: '', debitAmount: '', creditAmount: '' },
        { accountId: '', debitAmount: '', creditAmount: '' },
    ]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        api.getAccounts({}).then((data: any) => setAccounts(Array.isArray(data) ? data : data.data ?? [])).catch(() => {});
    }, []);

    const totalDebit = rows.reduce((s, r) => s + (parseFloat(r.debitAmount) || 0), 0);
    const totalCredit = rows.reduce((s, r) => s + (parseFloat(r.creditAmount) || 0), 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    const setRow = (i: number, field: keyof EntryRow, value: string) => {
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
    };

    const addRow = () => setRows((prev) => [...prev, { accountId: '', debitAmount: '', creditAmount: '' }]);
    const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

    const handleSubmit = async () => {
        setError(null);
        const entries = rows
            .filter((r) => r.accountId && (parseFloat(r.debitAmount) > 0 || parseFloat(r.creditAmount) > 0))
            .map((r) => ({
                accountId: r.accountId,
                debitAmount: parseFloat(r.debitAmount) || 0,
                creditAmount: parseFloat(r.creditAmount) || 0,
            }));

        if (entries.length < 2) { setError('Add at least 2 entries.'); return; }

        setSubmitting(true);
        try {
            await api.importOpeningBalances({ asOfDate, entries });
            setSuccess(true);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to import opening balances');
        } finally {
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
                <div className="max-w-[900px] mx-auto">
                    <div className="bg-white border border-emerald-100 rounded-2xl p-8 text-center">
                        <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                        <h2 className="text-xl font-black text-gray-900 mb-2">Opening Balances Imported</h2>
                        <p className="text-gray-500 text-sm mb-6">A journal voucher has been created with your opening balances.</p>
                        <button onClick={() => { setSuccess(false); setRows([{ accountId: '', debitAmount: '', creditAmount: '' }, { accountId: '', debitAmount: '', creditAmount: '' }]); }}
                            className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-bold text-white hover:bg-gray-700 transition">
                            Import Another
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Opening Balance Import</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Import opening account balances when migrating from another system
                    </p>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-end gap-4">
                    <div>
                        <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">As of Date</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-2.5 px-4 text-sm font-medium" />
                    </div>
                    <p className="text-xs text-gray-400 pb-1">Balances will be posted as a Journal voucher dated on this date.</p>
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400 w-1/2">Account</th>
                                <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Debit</th>
                                <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Credit</th>
                                <th className="w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, i) => (
                                <tr key={i} className="border-b border-gray-50">
                                    <td className="px-4 py-2">
                                        <select value={row.accountId} onChange={(e) => setRow(i, 'accountId', e.target.value)}
                                            className="w-full rounded-xl bg-gray-50 border-none py-2 px-3 text-sm">
                                            <option value="">Select account…</option>
                                            {accounts.map((a) => (
                                                <option key={a.id} value={a.id}>{a.name}{a.code ? ` (${a.code})` : ''}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-4 py-2">
                                        <input type="number" min="0" step="0.01" placeholder="0.00"
                                            value={row.debitAmount}
                                            onChange={(e) => { setRow(i, 'debitAmount', e.target.value); if (e.target.value) setRow(i, 'creditAmount', ''); }}
                                            className="w-full rounded-xl bg-gray-50 border-none py-2 px-3 text-sm text-right" />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input type="number" min="0" step="0.01" placeholder="0.00"
                                            value={row.creditAmount}
                                            onChange={(e) => { setRow(i, 'creditAmount', e.target.value); if (e.target.value) setRow(i, 'debitAmount', ''); }}
                                            className="w-full rounded-xl bg-gray-50 border-none py-2 px-3 text-sm text-right" />
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                        {rows.length > 2 && (
                                            <button onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-500 transition">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-gray-200 bg-gray-50">
                                <td className="px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-500">Totals</td>
                                <td className="px-4 py-3 text-right font-black text-sm">{formatBDT(totalDebit, { locale })}</td>
                                <td className="px-4 py-3 text-right font-black text-sm">{formatBDT(totalCredit, { locale })}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div className="flex items-center justify-between">
                    <button onClick={addRow}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">
                        <Plus className="w-4 h-4" /> Add Row
                    </button>
                    <div className="flex items-center gap-4">
                        {!isBalanced && (totalDebit > 0 || totalCredit > 0) && (
                            <span className="text-xs font-bold text-rose-600">
                                Difference: {formatBDT(Math.abs(totalDebit - totalCredit))}
                            </span>
                        )}
                        {isBalanced && (totalDebit > 0) && (
                            <span className="text-xs font-bold text-emerald-600">Balanced ✓</span>
                        )}
                        <button onClick={handleSubmit} disabled={submitting || !isBalanced || totalDebit === 0}
                            className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50 transition">
                            {submitting ? 'Posting…' : 'Post Opening Balances'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
