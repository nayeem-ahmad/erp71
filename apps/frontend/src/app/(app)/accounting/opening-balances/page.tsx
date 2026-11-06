'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, BookOpen, CheckCircle, Plus, Scale, Trash2 } from 'lucide-react';
import {
    ListStats,
    ListToolbar,
    type ListFilter,
    type ListStat,
    type ResolvedListFilter,
} from '@/components/data-table';
import { AccountingPageShell, CompactSection } from '@/components/accounting/compact';
import { ACCOUNT_TYPES } from '@/components/accounting/AccountFormModal';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Alert, Button } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import AccountSelect from '@/components/accounting/AccountSelect';
import { compactDensity } from '@/lib/ui/compact-density';

interface Account { id: string; name: string; code?: string | null; type: string; }
interface EntryRow { accountId: string; debitAmount: string; creditAmount: string; }

/** The account-type chip's value for a row with no account chosen yet. */
const NONE = '__none__';

const emptyRow = (): EntryRow => ({ accountId: '', debitAmount: '', creditAmount: '' });

function today() { return new Date().toISOString().slice(0, 10); }

const amountOf = (value: string) => parseFloat(value) || 0;
const hasAmount = (row: EntryRow) => amountOf(row.debitAmount) > 0 || amountOf(row.creditAmount) > 0;

export default function OpeningBalancesPage() {
    const { t, fmt, locale } = useI18n();
    const o = t.openingBalances;
    const m = t.accountingMastersUi.openingBalances;
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [asOfDate, setAsOfDate] = useState(today());
    const [rows, setRows] = useState<EntryRow[]>([emptyRow(), emptyRow()]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<string[]>([]);
    const [amountOnly, setAmountOnly] = useState(false);

    useEffect(() => {
        api.getAccounts({}).then((data: any) => setAccounts(Array.isArray(data) ? data : data.data ?? [])).catch(() => {});
    }, []);

    const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

    const totalDebit = rows.reduce((s, r) => s + amountOf(r.debitAmount), 0);
    const totalCredit = rows.reduce((s, r) => s + amountOf(r.creditAmount), 0);
    const difference = totalDebit - totalCredit;
    const isBalanced = Math.abs(difference) < 0.01;
    const hasAnyAmount = totalDebit > 0 || totalCredit > 0;

    const setRow = (i: number, field: keyof EntryRow, value: string) => {
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
    };

    const addRow = () => setRows((prev) => [...prev, emptyRow()]);
    const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

    /** The grid's rows the toolbar keeps, each with its place in the entry, which saving still posts whole. */
    const visibleRows = useMemo(
        () =>
            rows
                .map((row, index) => ({ row, index }))
                .filter(({ row }) => {
                    const account = accountById.get(row.accountId);
                    if (!matchesAnyOf(typeFilter, account?.type ?? NONE)) return false;
                    if (amountOnly && !hasAmount(row)) return false;
                    return matchesSearch(search, account?.code, account?.name);
                }),
        [rows, accountById, typeFilter, amountOnly, search],
    );
    const hiddenCount = rows.length - visibleRows.length;

    const filters = useMemo<ResolvedListFilter[]>(() => {
        const list: ListFilter[] = [
            {
                id: 'type',
                type: 'multi-select',
                label: m.accountType,
                value: typeFilter,
                onChange: setTypeFilter,
                options: [
                    ...ACCOUNT_TYPES.map((type) => ({ value: type, label: t.accountGroups.typeSections[type] })),
                    { value: NONE, label: m.noAccount },
                ],
            },
            {
                id: 'hasAmount',
                type: 'toggle',
                label: m.hasAmount,
                pressed: amountOnly,
                onChange: setAmountOnly,
                control: 'button',
            },
        ];
        return list as ResolvedListFilter[];
    }, [t, m, typeFilter, amountOnly]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const withBalance = new Set(rows.filter((r) => r.accountId && hasAmount(r)).map((r) => r.accountId)).size;
        const items: ListStat[] = [
            { id: 'debit', icon: <ArrowUpRight aria-hidden />, label: t.accountingShared.debitTotal, value: money(totalDebit) },
            { id: 'credit', icon: <ArrowDownLeft aria-hidden />, label: t.accountingShared.creditTotal, value: money(totalCredit) },
            {
                id: 'difference',
                icon: <Scale aria-hidden />,
                label: t.accountingShared.difference,
                value: money(Math.abs(difference)),
                hint: hasAnyAmount ? (isBalanced ? t.accountingShared.balanced : t.accountingShared.notBalanced) : undefined,
                tone: !isBalanced ? 'warning' : 'default',
            },
            {
                id: 'accounts',
                icon: <BookOpen aria-hidden />,
                label: m.accountsWithBalance,
                value: withBalance.toLocaleString(locale),
            },
        ];
        return items;
    }, [rows, totalDebit, totalCredit, difference, isBalanced, hasAnyAmount, locale, t, m]);

    const handleSubmit = async () => {
        setError(null);
        const entries = rows
            .filter((r) => r.accountId && (parseFloat(r.debitAmount) > 0 || parseFloat(r.creditAmount) > 0))
            .map((r) => ({
                accountId: r.accountId,
                debitAmount: parseFloat(r.debitAmount) || 0,
                creditAmount: parseFloat(r.creditAmount) || 0,
            }));

        if (entries.length < 2) { setError(o.addTwoEntries); return; }

        setSubmitting(true);
        try {
            await api.importOpeningBalances({ asOfDate, entries });
            setSuccess(true);
        } catch (e: any) {
            setError(e?.message ?? o.importFailed);
        } finally {
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <AccountingPageShell maxWidth="narrow">
                <CompactSection className="border-emerald-100 text-center py-8">
                    <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                    <h2 className={compactDensity.modalTitle}>{o.importSuccess}</h2>
                    <p className="text-gray-500 text-xs mt-1 mb-4">{o.importSuccessHint}</p>
                    <Button
                        variant="primary"
                        onClick={() => {
                            setSuccess(false);
                            setRows([emptyRow(), emptyRow()]);
                        }}
                    >
                        {m.importAnother}
                    </Button>
                </CompactSection>
            </AccountingPageShell>
        );
    }

    return (
        <AccountingPageShell>
            <PageHeader
                title={o.title}
                subtitle={o.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    o.title,
                    'accounting',
                )}
            />

            <CompactSection>
                <div className="flex items-end gap-4 flex-wrap">
                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>{o.asOfDate}</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={compactDensity.formField} />
                    </label>
                    <p className="text-xs text-gray-400 pb-1">{o.asOfDateHint}</p>
                </div>
            </CompactSection>

            <ListStats stats={stats} label={m.statsLabel} />

            <ListToolbar
                tableId="accounting-opening-balances"
                filters={filters}
                search={{ value: search, onChange: setSearch, placeholder: m.searchPlaceholder }}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            <CompactSection className="!p-0 overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-100">
                            <th className="text-start px-4 py-3 text-xs font-semibold text-gray-500 w-1/2">{o.columns.account}</th>
                            <th className="text-end px-4 py-3 text-xs font-semibold text-gray-500">{o.columns.debit}</th>
                            <th className="text-end px-4 py-3 text-xs font-semibold text-gray-500">{o.columns.credit}</th>
                            <th className="w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">{m.noMatch}</td>
                            </tr>
                        ) : visibleRows.map(({ row, index: i }) => (
                            <tr key={i} className="border-b border-gray-50">
                                <td className="px-4 py-2">
                                    <AccountSelect
                                        accounts={accounts}
                                        value={row.accountId}
                                        onChange={(accountId) => setRow(i, 'accountId', accountId)}
                                        ariaLabel={fmt(m.accountRow, { n: i + 1 })}
                                        className={compactDensity.formField}
                                    />
                                </td>
                                <td className="px-4 py-2">
                                    <input type="number" min="0" step="0.01" placeholder="0.00"
                                        aria-label={`${o.columns.debit} ${i + 1}`}
                                        value={row.debitAmount}
                                        onChange={(e) => { setRow(i, 'debitAmount', e.target.value); if (e.target.value) setRow(i, 'creditAmount', ''); }}
                                        className={`${compactDensity.formField} text-end`} />
                                </td>
                                <td className="px-4 py-2">
                                    <input type="number" min="0" step="0.01" placeholder="0.00"
                                        aria-label={`${o.columns.credit} ${i + 1}`}
                                        value={row.creditAmount}
                                        onChange={(e) => { setRow(i, 'creditAmount', e.target.value); if (e.target.value) setRow(i, 'debitAmount', ''); }}
                                        className={`${compactDensity.formField} text-end`} />
                                </td>
                                <td className="px-2 py-2 text-center">
                                    {rows.length > 2 && (
                                        <button
                                            type="button"
                                            onClick={() => removeRow(i)}
                                            aria-label={fmt(m.removeRow, { n: i + 1 })}
                                            title={fmt(m.removeRow, { n: i + 1 })}
                                            className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 md:min-h-0 md:min-w-0 md:p-1.5"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="border-t border-gray-200 bg-gray-50">
                            <td className="px-4 py-3 text-xs font-semibold text-gray-500">{o.totals}</td>
                            <td className="px-4 py-3 text-end font-semibold tabular-nums">{formatBDT(totalDebit, { locale })}</td>
                            <td className="px-4 py-3 text-end font-semibold tabular-nums">{formatBDT(totalCredit, { locale })}</td>
                            <td />
                        </tr>
                    </tfoot>
                </table>
            </CompactSection>

            {hiddenCount > 0 && (
                <p className="text-xs text-gray-500">{fmt(m.hiddenRows, { count: hiddenCount.toLocaleString(locale) })}</p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={addRow}>
                    {m.addRow}
                </Button>
                <div className="flex items-center gap-3">
                    {!isBalanced && hasAnyAmount && (
                        <span className="text-xs font-semibold text-amber-700">
                            {t.accountingShared.difference}: {formatBDT(Math.abs(difference), { locale })}
                        </span>
                    )}
                    {isBalanced && totalDebit > 0 && (
                        <span className="text-xs font-semibold text-emerald-600">{o.balanced}</span>
                    )}
                    <Button
                        variant="primary"
                        onClick={() => void handleSubmit()}
                        loading={submitting}
                        disabled={!isBalanced || totalDebit === 0}
                    >
                        {submitting ? o.posting : o.postBalances}
                    </Button>
                </div>
            </div>
        </AccountingPageShell>
    );
}
