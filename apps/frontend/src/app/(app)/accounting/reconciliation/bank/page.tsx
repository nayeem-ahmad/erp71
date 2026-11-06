'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Check, CircleCheck, CircleDashed, Landmark, Scale, Sparkles, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import type { CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import {
    AccountingPageShell,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Alert, Button, StatusBadge } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import AccountSelect from '@/components/accounting/AccountSelect';
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

const STEPS = ['setup', 'import', 'match'] as const;
const ENTRY_TYPES = ['DEBIT', 'CREDIT'] as const;
const MATCH_STATES = ['matched', 'unmatched'] as const;

const columnHelper = createColumnHelper<StatementEntry>();

const matchStateOf = (entry: StatementEntry) => (entry.is_matched ? 'matched' : 'unmatched');

export default function BankReconciliationPage() {
    const { t, locale } = useI18n();
    const ui = t.accountingFinanceUi.bankReconciliation;
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [step, setStep] = useState<'setup' | 'import' | 'match' | 'done'>('setup');
    const [reconId, setReconId] = useState<string | null>(null);
    const [report, setReport] = useState<ReconciliationReport | null>(null);
    const [form, setForm] = useState({ accountId: '', statementDate: new Date().toISOString().slice(0, 10), statementClosingBalance: '' });
    const [csvText, setCsvText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const [autoMatched, setAutoMatched] = useState(false);

    const [search, setSearch] = useState('');
    const [matchStates, setMatchStates] = useState<string[]>([]);
    const [entryTypes, setEntryTypes] = useState<string[]>([]);
    const [dateRange, setDateRange] = useState<CreatedRange | null>(null);
    const [amountFilter, setAmountFilter] = useState<NumberCondition | null>(null);

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
            setError(e?.message ?? ui.createFailed);
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
            setError(e?.message ?? ui.importFailed);
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
            setError(e?.message ?? ui.autoMatchFailed);
        } finally {
            setWorking(false);
        }
    };

    const entryTypeLabel = (type: string) => (type === 'CREDIT' ? t.accountingShared.credit : t.accountingShared.debit);
    const matchStateLabel = (state: string) => (state === 'matched' ? t.reconciliation.matched : t.reconciliation.unmatched);

    const entries = report?.entries ?? [];

    const filtered = useMemo(
        () => entries.filter((entry) => {
            if (!matchesAnyOf(matchStates, matchStateOf(entry))) return false;
            if (!matchesAnyOf(entryTypes, entry.entry_type)) return false;
            if (!inDateRange(entry.entry_date, dateRange)) return false;
            if (!matchesNumberCondition(Number(entry.amount || 0), amountFilter)) return false;
            return matchesSearch(search, entry.description, String(entry.amount ?? ''), entryTypeLabel(entry.entry_type));
        }),
        [entries, matchStates, entryTypes, dateRange, amountFilter, search, t],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'match',
                type: 'multi-select',
                label: t.common.status,
                value: matchStates,
                onChange: setMatchStates,
                options: MATCH_STATES.map((value) => ({ value, label: matchStateLabel(value) })),
            },
            {
                id: 'type',
                type: 'multi-select',
                label: t.accountingShared.type,
                value: entryTypes,
                onChange: setEntryTypes,
                options: ENTRY_TYPES.map((value) => ({ value, label: entryTypeLabel(value) })),
            },
            {
                id: 'date',
                type: 'date-range',
                label: t.accountingShared.date,
                value: dateRange,
                onChange: setDateRange,
                operators: true,
            },
            {
                id: 'amount',
                type: 'number',
                label: t.accountingShared.amount,
                value: amountFilter,
                onChange: setAmountFilter,
                money: true,
            },
        ],
        [t, matchStates, entryTypes, dateRange, amountFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const n = (value: number) => value.toLocaleString(locale);
        const matched = filtered.filter((entry) => entry.is_matched);
        const unmatched = filtered.filter((entry) => !entry.is_matched);
        const sum = (rows: StatementEntry[]) => rows.reduce((total, entry) => total + Number(entry.amount || 0), 0);
        const difference = report?.difference ?? 0;
        const items: ListStat[] = [
            { id: 'book', icon: <Wallet aria-hidden />, label: ui.bookBalance, value: money(report?.book_balance ?? 0) },
            { id: 'statement', icon: <Landmark aria-hidden />, label: ui.statementBalance, value: money(report?.statement_balance ?? 0) },
            {
                id: 'difference',
                icon: <Scale aria-hidden />,
                label: t.accountingShared.difference,
                value: money(difference),
                tone: Math.abs(difference) < 0.01 ? 'default' : 'danger',
            },
            {
                id: 'matched',
                icon: <CircleCheck aria-hidden />,
                label: t.reconciliation.matched,
                value: n(matched.length),
                hint: money(sum(matched)),
            },
            {
                id: 'unmatched',
                icon: <CircleDashed aria-hidden />,
                label: t.reconciliation.unmatched,
                value: n(unmatched.length),
                hint: money(sum(unmatched)),
                tone: unmatched.length > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading: working, label: ui.statsLabel };
    }, [filtered, report, working, locale, t, ui]);

    const columns: ColumnDef<StatementEntry, any>[] = useMemo(
        () => [
            columnHelper.accessor('entry_date', {
                header: t.accountingShared.date,
                cell: (info) => formatDate(info.getValue(), locale),
                sortingFn: 'datetime',
                size: 110,
            }),
            columnHelper.accessor((row) => row.description ?? '', {
                id: 'description',
                header: t.accountingShared.description,
                cell: (info) => info.getValue() || '—',
                size: 260,
            }),
            columnHelper.accessor((row) => Number(row.amount || 0), {
                id: 'amount',
                header: t.accountingShared.amount,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end' },
                size: 120,
            }),
            columnHelper.accessor('entry_type', {
                header: t.accountingShared.type,
                cell: (info) => entryTypeLabel(info.getValue()),
                meta: { hideOnMobile: true },
                size: 90,
            }),
            columnHelper.accessor(matchStateOf, {
                id: 'match',
                header: t.common.status,
                cell: (info) => (
                    info.getValue() === 'matched'
                        ? <StatusBadge tone="success">{t.reconciliation.matched}</StatusBadge>
                        : <StatusBadge tone="warning">{t.reconciliation.unmatched}</StatusBadge>
                ),
                size: 110,
            }),
        ],
        [t, locale],
    );

    const stepIndex = STEPS.indexOf(step as (typeof STEPS)[number]);

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.reconciliation.title}
                subtitle={t.reconciliation.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.reconciliation.title,
                    'accounting',
                )}
            />

            <ol className="flex items-center gap-2 text-xs">
                {STEPS.map((s, i) => {
                    const done = stepIndex > i;
                    const current = step === s;
                    return (
                        <li key={s} className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${current ? 'bg-blue-600 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                {done ? <Check className="w-3.5 h-3.5" aria-hidden /> : i + 1}
                            </span>
                            <span className={`font-semibold ${current ? 'text-gray-900' : 'text-gray-400'}`}>{ui.steps[s]}</span>
                            {i < STEPS.length - 1 && <span className="w-8 h-px bg-gray-200" />}
                        </li>
                    );
                })}
            </ol>

            {error && <Alert tone="danger">{error}</Alert>}

            {step === 'setup' && (
                <CompactSection title={ui.setupTitle}>
                    <div className={`${compactDensity.formStack} max-w-xl`}>
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>{t.reconciliation.bankAccount}</span>
                            <AccountSelect
                                accounts={accounts}
                                value={form.accountId}
                                onChange={(accountId) => setForm((f) => ({ ...f, accountId }))}
                                ariaLabel={t.reconciliation.bankAccount}
                                placeholder={ui.selectBankAccount}
                                className={compactDensity.formField}
                            />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{ui.statementDate}</span>
                                <input type="date" value={form.statementDate} onChange={(e) => setForm((f) => ({ ...f, statementDate: e.target.value }))} className={compactDensity.formField} />
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{ui.closingBalance}</span>
                                <input type="number" step="0.01" value={form.statementClosingBalance} onChange={(e) => setForm((f) => ({ ...f, statementClosingBalance: e.target.value }))} placeholder="0.00" className={compactDensity.formField} />
                            </label>
                        </div>
                        <div>
                            <Button variant="primary" onClick={handleSetup} loading={working} disabled={!form.accountId || !form.statementClosingBalance}>
                                {working ? ui.creating : ui.nextImport}
                            </Button>
                        </div>
                    </div>
                </CompactSection>
            )}

            {step === 'import' && (
                <CompactSection title={ui.importTitle}>
                    <p className="text-xs text-gray-500 mb-2">{ui.importHint} <code className="bg-gray-100 px-1 rounded text-xs">YYYY-MM-DD, Description, Amount, DEBIT|CREDIT</code></p>
                    <textarea rows={8} value={csvText} onChange={(e) => setCsvText(e.target.value)}
                        placeholder={`2026-06-01, Salary payment, 50000, DEBIT\n2026-06-02, Customer deposit, 30000, CREDIT`}
                        aria-label={ui.importTitle}
                        className={`${compactDensity.formField} font-mono resize-none mb-3`} />
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => setStep('setup')}>{t.common.back}</Button>
                        <Button variant="primary" onClick={handleImport} loading={working} disabled={!csvText.trim()}>
                            {working ? ui.importing : ui.importContinue}
                        </Button>
                    </div>
                </CompactSection>
            )}

            {step === 'match' && report && (
                <DataTable
                    tableId="bank-reconciliation-entries"
                    title={t.reconciliation.matchEntries}
                    data={filtered}
                    columns={columns}
                    searchPlaceholder={ui.search}
                    searchValue={search}
                    onSearchChange={setSearch}
                    filters={filters}
                    filterLayout="row"
                    stats={stats}
                    enableColumnFilters={false}
                    viewOptions
                    rowClassName={(entry) => (entry.is_matched ? 'opacity-60' : undefined)}
                    emptyMessage={t.common.noData}
                    toolbarActions={!autoMatched ? (
                        <Button variant="secondary" icon={<Sparkles className="w-3.5 h-3.5" />} onClick={handleAutoMatch} loading={working}>
                            {working ? ui.matching : ui.autoMatch}
                        </Button>
                    ) : undefined}
                />
            )}
        </AccountingPageShell>
    );
}
