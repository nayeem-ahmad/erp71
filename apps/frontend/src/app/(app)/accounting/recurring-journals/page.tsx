'use client';

import { useEffect, useState } from 'react';
import { Plus, Play, Trash2 } from 'lucide-react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

interface RJLine { accountId: string; debitAmount: string; creditAmount: string; comment: string; }
interface RJTemplate {
    id: string;
    name: string;
    description?: string;
    frequency: string;
    next_due_date: string;
    last_run_date?: string;
    is_active: boolean;
    lines: Array<{ account: { name: string }; debit_amount: number; credit_amount: number }>;
}

export default function RecurringJournalsPage() {
    const { t, locale } = useI18n();
    const [templates, setTemplates] = useState<RJTemplate[]>([]);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: '', description: '', frequency: 'MONTHLY', nextDueDate: '' });
    const [lines, setLines] = useState<RJLine[]>([{ accountId: '', debitAmount: '', creditAmount: '', comment: '' }, { accountId: '', debitAmount: '', creditAmount: '', comment: '' }]);
    const [creating, setCreating] = useState(false);
    const [posting, setPosting] = useState<string | null>(null);
    const [postResult, setPostResult] = useState<{ id: string; msg: string } | null>(null);

    useEffect(() => {
        void load();
        api.getAccounts({}).then((d: any) => setAccounts(Array.isArray(d) ? d : d.data ?? [])).catch(() => {});
    }, []);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.listRecurringJournals();
            setTemplates(Array.isArray(data) ? data : data.data ?? []);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    const setLine = (i: number, field: keyof RJLine, value: string) =>
        setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));

    const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debitAmount) || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.creditAmount) || 0), 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    const handleCreate = async () => {
        setCreating(true);
        setError(null);
        try {
            const payload = {
                name: form.name,
                description: form.description || undefined,
                frequency: form.frequency,
                nextDueDate: form.nextDueDate,
                lines: lines
                    .filter((l) => l.accountId)
                    .map((l) => ({
                        accountId: l.accountId,
                        debitAmount: parseFloat(l.debitAmount) || 0,
                        creditAmount: parseFloat(l.creditAmount) || 0,
                        comment: l.comment || undefined,
                    })),
            };
            await api.createRecurringJournal(payload);
            setShowCreate(false);
            setForm({ name: '', description: '', frequency: 'MONTHLY', nextDueDate: '' });
            setLines([{ accountId: '', debitAmount: '', creditAmount: '', comment: '' }, { accountId: '', debitAmount: '', creditAmount: '', comment: '' }]);
            await load();
        } catch (e: any) {
            setError(e?.message ?? 'Failed to create');
        } finally {
            setCreating(false);
        }
    };

    const handlePost = async (id: string) => {
        setPosting(id);
        setPostResult(null);
        try {
            const result = await api.postRecurringJournal(id);
            setPostResult({ id, msg: `Posted as ${result.voucher_number ?? 'voucher'}` });
            await load();
        } catch (e: any) {
            setPostResult({ id, msg: `Error: ${e?.message ?? 'Failed'}` });
        } finally {
            setPosting(null);
        }
    };

    return (
        <AccountingPageShell>
            <AccountingToolbar
                subtitle="Schedule repeating entries — rent, salaries, subscriptions"
                actions={(
                    <button onClick={() => setShowCreate(true)} className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700`}>
                        <Plus className="w-3.5 h-3.5" /> New Template
                    </button>
                )}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {showCreate && (
                <CompactSection title="New Recurring Journal">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="col-span-2 block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>Template Name</span>
                            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Monthly Rent" className={compactDensity.formField} />
                        </label>
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>Frequency</span>
                            <select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))} className={compactDensity.formField}>
                                <option value="MONTHLY">Monthly</option>
                                <option value="WEEKLY">Weekly</option>
                                <option value="DAILY">Daily</option>
                            </select>
                        </label>
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>Next Due Date</span>
                            <input type="date" value={form.nextDueDate} onChange={(e) => setForm((f) => ({ ...f, nextDueDate: e.target.value }))} className={compactDensity.formField} />
                        </label>
                    </div>

                        <table className="w-full text-sm border border-gray-100 rounded-xl overflow-hidden">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="text-left px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-400">Account</th>
                                    <th className="text-right px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-400">Debit</th>
                                    <th className="text-right px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-400">Credit</th>
                                    <th className="w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((l, i) => (
                                    <tr key={i} className="border-t border-gray-100">
                                        <td className="px-3 py-1.5">
                                            <select value={l.accountId} onChange={(e) => setLine(i, 'accountId', e.target.value)}
                                                className={compactDensity.formField}>
                                                <option value="">Select…</option>
                                                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                            </select>
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <input type="number" min="0" step="0.01" value={l.debitAmount}
                                                onChange={(e) => { setLine(i, 'debitAmount', e.target.value); if (e.target.value) setLine(i, 'creditAmount', ''); }}
                                                className={`${compactDensity.formField} text-right`} placeholder="0.00" />
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <input type="number" min="0" step="0.01" value={l.creditAmount}
                                                onChange={(e) => { setLine(i, 'creditAmount', e.target.value); if (e.target.value) setLine(i, 'debitAmount', ''); }}
                                                className={`${compactDensity.formField} text-right`} placeholder="0.00" />
                                        </td>
                                        <td className="px-2 py-1.5 text-center">
                                            {lines.length > 2 && (
                                                <button onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                                                    className="text-gray-300 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div className="flex items-center justify-between">
                            <button onClick={() => setLines((p) => [...p, { accountId: '', debitAmount: '', creditAmount: '', comment: '' }])}
                                className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-500 hover:text-gray-900 transition">
                                <Plus className="w-3.5 h-3.5" /> Add Line
                            </button>
                            <span className={`text-xs font-bold ${isBalanced && totalDebit > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {isBalanced && totalDebit > 0 ? `Balanced — ${formatBDT(totalDebit, { locale })}` : `Diff: ${formatBDT(Math.abs(totalDebit - totalCredit))}`}
                            </span>
                        </div>

                    <div className="flex gap-2 mt-3">
                        <button onClick={() => setShowCreate(false)} className={compactDensity.btnSecondary}>Cancel</button>
                        <button onClick={handleCreate} disabled={creating || !form.name || !form.nextDueDate || !isBalanced || totalDebit === 0}
                            className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50`}>
                            {creating ? 'Saving…' : 'Save Template'}
                        </button>
                    </div>
                </CompactSection>
            )}

            {loading ? (
                <CompactSection className="text-center text-gray-400 text-sm py-8">Loading…</CompactSection>
            ) : templates.length === 0 ? (
                <CompactSection className="text-center text-gray-400 text-sm py-6">No recurring journals yet.</CompactSection>
            ) : (
                <div className="space-y-2">
                    {templates.map((t) => (
                        <CompactSection key={t.id}>
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="font-black text-gray-900">{t.name}</div>
                                        {t.description && <div className="text-sm text-gray-500 mt-0.5">{t.description}</div>}
                                        <div className="flex gap-4 mt-2 text-xs text-gray-400">
                                            <span className="font-bold">{t.frequency}</span>
                                            <span>Next: <span className="font-bold text-gray-600">{new Date(t.next_due_date).toLocaleDateString()}</span></span>
                                            {t.last_run_date && <span>Last run: {new Date(t.last_run_date).toLocaleDateString()}</span>}
                                        </div>
                                    </div>
                                    <button onClick={() => handlePost(t.id)} disabled={posting === t.id}
                                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition">
                                        <Play className="w-3 h-3" /> {posting === t.id ? 'Posting…' : 'Post Now'}
                                    </button>
                                </div>
                                {postResult?.id === t.id && (
                                    <div className={`mt-3 rounded-xl p-2 text-xs font-medium ${postResult.msg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                        {postResult.msg}
                                    </div>
                                )}
                                <div className="mt-3 border-t border-gray-50 pt-3 space-y-1">
                                    {t.lines.map((l, i) => (
                                        <div key={i} className="flex justify-between text-xs text-gray-500">
                                            <span>{l.account.name}</span>
                                            <span>
                                                {Number(l.debit_amount) > 0 ? <span className="text-gray-700">Dr {formatBDT(Number(l.debit_amount), { locale })}</span> : <span className="text-gray-400">Cr {formatBDT(Number(l.credit_amount), { locale })}</span>}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                        </CompactSection>
                    ))}
                </div>
            )}
        </AccountingPageShell>
    );
}
