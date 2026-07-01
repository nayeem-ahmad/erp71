'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Circle } from 'lucide-react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
    CompactStat,
} from '@/components/accounting/compact';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

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
        const summary = data.summary ?? data;
        const matched = (data.matched_entries ?? []).map((e: StatementEntry) => ({ ...e, is_matched: true }));
        const unmatched = (data.unmatched_entries ?? []).map((e: StatementEntry) => ({ ...e, is_matched: false }));
        const legacyEntries = Array.isArray(data.entries) ? data.entries : [];
        setReport({
            reconciliation: data.reconciliation,
            book_balance: summary.book_balance ?? data.book_balance ?? 0,
            statement_balance: summary.statement_balance ?? data.statement_balance ?? 0,
            difference: summary.difference ?? data.difference ?? 0,
            matched_count: summary.matched_entries ?? data.matched_count ?? matched.length,
            unmatched_count: summary.unmatched_entries ?? data.unmatched_count ?? unmatched.length,
            entries: legacyEntries.length > 0 ? legacyEntries : [...matched, ...unmatched],
        });
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
        <AccountingPageShell>
            <AccountingToolbar subtitle="Match bank statement entries against bookkeeping records." />

            <div className="flex items-center gap-2 text-xs">
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

                {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

                {step === 'setup' && (
                    <CompactSection title="1. Set up reconciliation">
                        <div className={`${compactDensity.formStack} max-w-xl`}>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>Bank Account</span>
                                <select value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} className={compactDensity.formField}>
                                    <option value="">Select bank account…</option>
                                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>Statement Date</span>
                                    <input type="date" value={form.statementDate} onChange={(e) => setForm((f) => ({ ...f, statementDate: e.target.value }))} className={compactDensity.formField} />
                                </label>
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>Statement Closing Balance</span>
                                    <input type="number" step="0.01" value={form.statementClosingBalance} onChange={(e) => setForm((f) => ({ ...f, statementClosingBalance: e.target.value }))} placeholder="0.00" className={compactDensity.formField} />
                                </label>
                            </div>
                            <button onClick={handleSetup} disabled={working || !form.accountId || !form.statementClosingBalance} className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50`}>
                                {working ? 'Creating…' : 'Next: Import Statement'}
                            </button>
                        </div>
                    </CompactSection>
                )}

                {step === 'import' && (
                    <CompactSection title="2. Paste bank statement entries">
                        <p className="text-xs text-gray-500 mb-2">One row per line: <code className="bg-gray-100 px-1 rounded text-xs">YYYY-MM-DD, Description, Amount, DEBIT|CREDIT</code></p>
                        <textarea rows={8} value={csvText} onChange={(e) => setCsvText(e.target.value)}
                            placeholder={`2026-06-01, Salary payment, 50000, DEBIT\n2026-06-02, Customer deposit, 30000, CREDIT`}
                            className={`${compactDensity.formField} font-mono resize-none mb-3`} />
                        <div className="flex gap-2">
                            <button onClick={() => setStep('setup')} className={compactDensity.btnSecondary}>Back</button>
                            <button onClick={handleImport} disabled={working || !csvText.trim()} className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50`}>
                                {working ? 'Importing…' : 'Import & Continue'}
                            </button>
                        </div>
                    </CompactSection>
                )}

                {step === 'match' && report && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                            <CompactStat label="Book Balance" value={formatBDT(report.book_balance, { locale })} />
                            <CompactStat label="Statement Balance" value={formatBDT(report.statement_balance, { locale })} />
                            <CompactStat label="Difference" value={formatBDT(report.difference, { locale })} tone={Math.abs(report.difference) < 0.01 ? 'positive' : 'negative'} />
                        </div>

                        <CompactSection>
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-gray-600">
                                    <span className="font-semibold text-emerald-600">{report.matched_count} matched</span>
                                    {' · '}
                                    <span className="font-semibold text-amber-600">{report.unmatched_count} unmatched</span>
                                </div>
                                {!autoMatched && (
                                    <button onClick={handleAutoMatch} disabled={working} className={`${compactDensity.btnSecondary} text-blue-700 border-blue-100 bg-blue-50 hover:bg-blue-100 disabled:opacity-50`}>
                                        {working ? 'Matching…' : 'Auto-Match by Date & Amount'}
                                    </button>
                                )}
                            </div>
                        </CompactSection>

                        <CompactSection className="!p-0 overflow-hidden">
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
                        </CompactSection>
                    </div>
                )}
        </AccountingPageShell>
    );
}
