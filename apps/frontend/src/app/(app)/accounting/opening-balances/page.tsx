'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, CheckCircle } from 'lucide-react';
import {
    AccountingPageShell,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

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
            <AccountingPageShell maxWidth="narrow">
                <CompactSection className="border-emerald-100 text-center py-8">
                    <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                    <h2 className={compactDensity.modalTitle}>Opening Balances Imported</h2>
                    <p className="text-gray-500 text-xs mt-1 mb-4">A journal voucher has been created with your opening balances.</p>
                    <button onClick={() => { setSuccess(false); setRows([{ accountId: '', debitAmount: '', creditAmount: '' }, { accountId: '', debitAmount: '', creditAmount: '' }]); }}
                        className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700`}>
                        Import Another
                    </button>
                </CompactSection>
            </AccountingPageShell>
        );
    }

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.openingBalances.title}
                subtitle={t.openingBalances.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.openingBalances.title,
                    'accounting',
                )}
            />

            <CompactSection>
                <div className="flex items-end gap-4 flex-wrap">
                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>As of Date</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={compactDensity.formField} />
                    </label>
                    <p className="text-xs text-gray-400 pb-1">Balances will be posted as a Journal voucher dated on this date.</p>
                </div>
            </CompactSection>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            <CompactSection className="!p-0 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 w-1/2">Account</th>
                                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Debit</th>
                                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Credit</th>
                                <th className="w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, i) => (
                                <tr key={i} className="border-b border-gray-50">
                                    <td className="px-4 py-2">
                                        <select value={row.accountId} onChange={(e) => setRow(i, 'accountId', e.target.value)}
                                            className={compactDensity.formField}>
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
                                            className={`${compactDensity.formField} text-right`} />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input type="number" min="0" step="0.01" placeholder="0.00"
                                            value={row.creditAmount}
                                            onChange={(e) => { setRow(i, 'creditAmount', e.target.value); if (e.target.value) setRow(i, 'debitAmount', ''); }}
                                            className={`${compactDensity.formField} text-right`} />
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
                                <td className="px-4 py-3 text-xs font-semibold text-gray-500">Totals</td>
                                <td className="px-4 py-3 text-right font-bold text-sm">{formatBDT(totalDebit, { locale })}</td>
                                <td className="px-4 py-3 text-right font-bold text-sm">{formatBDT(totalCredit, { locale })}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
            </CompactSection>

            <div className="flex items-center justify-between">
                <button onClick={addRow} className={compactDensity.btnSecondary}>
                    <Plus className="w-3.5 h-3.5" /> Add Row
                </button>
                <div className="flex items-center gap-3">
                    {!isBalanced && (totalDebit > 0 || totalCredit > 0) && (
                        <span className="text-xs font-semibold text-danger">
                            Difference: {formatBDT(Math.abs(totalDebit - totalCredit))}
                        </span>
                    )}
                    {isBalanced && (totalDebit > 0) && (
                        <span className="text-xs font-semibold text-emerald-600">Balanced ✓</span>
                    )}
                    <button onClick={handleSubmit} disabled={submitting || !isBalanced || totalDebit === 0}
                        className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50`}>
                        {submitting ? 'Posting…' : 'Post Opening Balances'}
                    </button>
                </div>
            </div>
        </AccountingPageShell>
    );
}
