'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface BankAccount { id: string; name: string; code?: string | null; }
interface StatementEntry {
    id: string;
    entry_date: string;
    description?: string;
    amount: number;
    entry_type: string;
    is_matched: boolean;
    matched_voucher_detail_id?: string;
}
interface ReconciliationReport {
    reconciliation: { id: string; account_id: string; statement_date: string; statement_closing_balance: number; status: string };
    book_balance: number;
    statement_balance: number;
    difference: number;
    matched_count: number;
    unmatched_count: number;
    entries: StatementEntry[];
}

export default function BankReconciliationPage() {
    const { t, locale } = useI18n();
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [step, setStep] = useState<'setup' | 'import' | 'match' | 'done'>('setup');
    const [reconId, setReconId] = useState<string | null>(null);
    const [report, setReport] = useState<ReconciliationReport | null>(null);
    const [form, setForm] = useState({ accountId: '', statementDate: new Date().toISOString().slice(0, 10), statementClosingBalance: '' });
    const [csvText, setCsvText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const [autoMatched, setAutoMatched] = useState(false);

    useEffect(() => {
        api.getAccounts({ category: 'bank' }).then((d: any) => {
            const all: BankAccount[] = Array.isArray(d) ? d : d.data ?? [];
            setAccounts(all.filter((a: any) => a.category === 'BANK' || a.category === 'bank'));
        }).catch(() => {});
    }, []);

    const loadReport = async (id: string) => {
        const data = await api.getBankReconciliationReport(id);
        setReport(data);
    };

    const handleSetup = async () => {
        setWorking(true);
        setError(null);
        try {
            const result = await api.createBankReconciliation({
                accountId: form.accountId,
                statementDate: form.statementDate,
                statementClosingBalance: parseFloat(form.statementClosingBalance),
            });
            setReconId(result.id);
            setStep('import');
        } catch (e: any) {
            setError(e?.message ?? 'Failed to create reconciliation');
        } finally {
            setWorking(false);
        }
    };

    const handleImport = async () => {
        if (!reconId) return;
        setWorking(true);
        setError(null);
        try {
            const entries = csvText.trim().split('\n').filter(Boolean).map((line) => {
                const [dateRaw, description, amountRaw, entryTypeRaw] = line.split(',').map((s) => s.trim());
                return {
                    entryDate: dateRaw,
                    description: description || undefined,
                    amount: Math.abs(parseFloat(amountRaw)),
                    entryType: entryTypeRaw?.toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT',
                };
            });
            await api.importBankStatementEntries({ reconciliationId: reconId, entries });
            await loadReport(reconId);
            setStep('match');
        } catch (e: any) {
            setError(e?.message ?? 'Failed to import entries');
        } finally {
            setWorking(false);
        }
    };

    const handleAutoMatch = async () => {
        if (!reconId) return;
        setWorking(true);
        try {
            await api.autoMatchBankEntries(reconId);
            await loadReport(reconId);
            setAutoMatched(true);
        } catch (e: any) {
            setError(e?.message ?? 'Auto-match failed');
        } finally {
            setWorking(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Bank Reconciliation</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Match bank statement entries against bookkeeping records
                    </p>
                </div>

                {/* Steps indicator */}
                <div className="flex items-center gap-2 text-sm">
                    {(['setup', 'import', 'match'] as const).map((s, i) => (
                        <div key={s} className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${step === s ? 'bg-gray-900 text-white' : ['setup','import','match'].indexOf(step) > i ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                {['setup','import','match'].indexOf(step) > i ? '✓' : i + 1}
                            </div>
                            <span className={`font-bold capitalize ${step === s ? 'text-gray-900' : 'text-gray-400'}`}>{s}</span>
                            {i < 2 && <div className="w-8 h-px bg-gray-200" />}
                        </div>
                    ))}
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                {step === 'setup' && (
                    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
                        <h2 className="font-black text-gray-900">1. Set up reconciliation</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Bank Account</span>
                                <select value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                                    className="w-full rounded-xl bg-gray-50 border-none py-2.5 px-4 text-sm">
                                    <option value="">Select bank account…</option>
                                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Statement Date</span>
                                <input type="date" value={form.statementDate} onChange={(e) => setForm((f) => ({ ...f, statementDate: e.target.value }))}
                                    className="w-full rounded-xl bg-gray-50 border-none py-2.5 px-4 text-sm" />
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Statement Closing Balance</span>
                                <input type="number" step="0.01" value={form.statementClosingBalance}
                                    onChange={(e) => setForm((f) => ({ ...f, statementClosingBalance: e.target.value }))}
                                    placeholder="0.00" className="w-full rounded-xl bg-gray-50 border-none py-2.5 px-4 text-sm" />
                            </div>
                        </div>
                        <button onClick={handleSetup} disabled={working || !form.accountId || !form.statementClosingBalance}
                            className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50 transition">
                            {working ? 'Creating…' : 'Next: Import Statement'}
                        </button>
                    </div>
                )}

                {step === 'import' && (
                    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
                        <h2 className="font-black text-gray-900">2. Paste bank statement entries</h2>
                        <p className="text-sm text-gray-500">One row per line: <code className="bg-gray-100 px-1 rounded text-xs">YYYY-MM-DD, Description, Amount, DEBIT|CREDIT</code></p>
                        <textarea rows={8} value={csvText} onChange={(e) => setCsvText(e.target.value)}
                            placeholder={`2026-06-01, Salary payment, 50000, DEBIT\n2026-06-02, Customer deposit, 30000, CREDIT`}
                            className="w-full rounded-xl bg-gray-50 border-none py-3 px-4 text-sm font-mono resize-none" />
                        <div className="flex gap-3">
                            <button onClick={() => setStep('setup')}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">Back</button>
                            <button onClick={handleImport} disabled={working || !csvText.trim()}
                                className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50 transition">
                                {working ? 'Importing…' : 'Import & Continue'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 'match' && report && (
                    <div className="space-y-4">
                        {/* Summary */}
                        <div className="grid grid-cols-3 gap-4">
                            {[
                                { label: 'Book Balance', value: formatBDT(report.book_balance, { locale }), color: 'text-gray-900' },
                                { label: 'Statement Balance', value: formatBDT(report.statement_balance, { locale }), color: 'text-gray-900' },
                                { label: 'Difference', value: formatBDT(report.difference, { locale }), color: Math.abs(report.difference) < 0.01 ? 'text-emerald-600' : 'text-rose-600' },
                            ].map(({ label, value, color }) => (
                                <div key={label} className="bg-white border border-gray-100 rounded-2xl p-4 text-center">
                                    <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-1">{label}</div>
                                    <div className={`text-xl font-black ${color}`}>{value}</div>
                                </div>
                            ))}
                        </div>

                        <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between">
                            <div className="text-sm text-gray-600">
                                <span className="font-bold text-emerald-600">{report.matched_count} matched</span>
                                {' · '}
                                <span className="font-bold text-amber-600">{report.unmatched_count} unmatched</span>
                            </div>
                            {!autoMatched && (
                                <button onClick={handleAutoMatch} disabled={working}
                                    className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition">
                                    {working ? 'Matching…' : 'Auto-Match by Date & Amount'}
                                </button>
                            )}
                        </div>

                        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Date</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Description</th>
                                        <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Amount</th>
                                        <th className="text-center px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Type</th>
                                        <th className="text-center px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.entries.map((e) => (
                                        <tr key={e.id} className={`border-b border-gray-50 ${e.is_matched ? 'opacity-60' : ''}`}>
                                            <td className="px-4 py-3 text-gray-500">{new Date(e.entry_date).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 text-gray-700">{e.description ?? '—'}</td>
                                            <td className="px-4 py-3 text-right font-medium">{formatBDT(Number(e.amount), { locale })}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`text-xs font-bold ${e.entry_type === 'CREDIT' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                    {e.entry_type}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {e.is_matched
                                                    ? <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
                                                    : <Circle className="w-4 h-4 text-gray-300 mx-auto" />}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
