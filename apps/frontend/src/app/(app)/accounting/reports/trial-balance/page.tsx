'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, Hash, Scale } from 'lucide-react';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import {
    DataTable,
    ListToolbar,
    type ListFilter,
    type ListStat,
    type ResolvedListFilter,
} from '@/components/data-table';
import CompareMatrixTable, { type CompareTrialBalanceRow } from '@/components/accounting/CompareMatrixTable';
import ReportPrintButton from '@/components/accounting/ReportPrintButton';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { formatBDT, formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { sheetPaper } from '@/lib/print';
import { resolvePrintPaper } from '@/lib/hooks/useSalePrintPrefs';
import { printTrialBalanceReport, reportContextLines } from '@/lib/statement-printer';
import {
    getDefaultHideZero,
    getDefaultReportLevel,
    getDefaultCompare,
    persistCompare,
    persistHideZero,
    persistReportLevel,
    REPORT_LEVEL_MODES,
    type ReportLevelMode,
    statementScopeParams,
    useApprovedOnly,
} from '@/lib/accounting-report-scope';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { BranchFilter } from '@/components/ui';
import { asOfFilter } from '../_shared/report-chips';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';

function defaultToday() {
    return new Date().toISOString().slice(0, 10);
}

interface TBRow {
    account: { id: string; name: string; code?: string | null; type: string; group: { name: string; code?: string | null }; subgroup?: { name: string } | null; is_unassigned?: boolean };
    debit_total: number;
    credit_total: number;
    closing_balance: number;
    closing_balance_side: string;
    debit_balance: number;
    credit_balance: number;
}

interface TBData {
    scope?: string;
    level?: ReportLevelMode;
    as_of: string;
    rows: TBRow[] | CompareTrialBalanceRow[];
    totals: { debit: number | Record<string, number>; credit: number | Record<string, number> };
    is_balanced?: boolean;
    columns?: Array<{ key: string; label: string; type?: string }>;
}

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

const columnHelper = createColumnHelper<TBRow>();

export default function TrialBalancePage() {
    const { t, locale } = useI18n();
    const ui = t.accountingBooksUi;
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('LIST_REPORT');
    // Which branch, or the whole company, is the page's branch filter;
    // "Compare branches" (consolidated viewers only) overrides it.
    const branch = useBranchScope();
    const stores = branch.branches;
    const canConsolidate = branch.canSeeAll;
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [data, setData] = useState<TBData | null>(null);
    const [compare, setCompare] = useState(false);
    const [level, setLevel] = useState<ReportLevelMode>('account');
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [includeCompanyBucket, setIncludeCompanyBucket] = useState(false);
    const [hideZero, setHideZero] = useState(false);
    const [asOfDate, setAsOfDate] = useState(defaultToday());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [initialized, setInitialized] = useState(false);
    const [search, setSearch] = useState('');
    const [accountTypes, setAccountTypes] = useState<string[]>([]);

    const scopeParams = statementScopeParams({
        compare,
        branchValue: branch.value,
        selectedStoreIds,
        includeCompanyBucket,
    });
    const scope = scopeParams.scope;
    const storeId = scopeParams.storeId ?? '';

    useEffect(() => {
        if (!branch.ready || stores.length === 0) {
            return;
        }

        setSelectedStoreIds(stores.map((store) => store.id));
        setCompare(getDefaultCompare(canConsolidate));
        setLevel(getDefaultReportLevel());
        setHideZero(getDefaultHideZero());
        setInitialized(true);
    }, [branch.ready, stores, canConsolidate]);

    const load = useCallback(async () => {
        // approvalReady gates the first fetch so the report is never generated
        // against the wrong approved-only value and then silently corrected.
        if (!initialized || !approvalReady) {
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const result = await api.getTrialBalance({
                approvedOnly,
                asOfDate: asOfDate || undefined,
                level,
                ...statementScopeParams({ compare, branchValue: branch.value, selectedStoreIds, includeCompanyBucket }),
            });
            setData(result);
        } catch (err: any) {
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            setError(err?.message ?? t.accounting.reports.loadFailed);
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asOfDate, compare, branch.value, level, selectedStoreIds, includeCompanyBucket, initialized, approvalReady, approvedOnly, t.accounting.reports.loadFailed]);

    useEffect(() => {
        if (initialized && approvalReady) {
            void load();
        }
    }, [initialized, approvalReady, load]);

    const isCompare = data?.scope === 'compare';
    const activeLevel = data?.level ?? 'account';
    const isRolledUp = activeLevel !== 'account';
    const rowLabel = t.accounting.reports.reportLevel[activeLevel];

    const accountTypeLabel = (type: string) => (
        (t.accountingShared.accountTypes as Record<string, string>)[type] ?? type
    );

    // Zero means the closing balance nets out. Only the two balance columns are
    // totalled, so dropping such a row never leaves a column that fails to tie.
    // The type chip and the search do narrow what adds up: `narrowed` says so.
    const narrowed = accountTypes.length > 0 || search.trim() !== '';
    const visibleRows = useMemo(() => {
        if (isCompare) return [];
        const rows = (data?.rows ?? []) as TBRow[];
        return rows.filter((row) => (
            (!hideZero || Math.abs(row.closing_balance) >= 0.005)
            && matchesAnyOf(accountTypes, row.account.type)
            && matchesSearch(search, row.account.code, row.account.name, row.account.group?.name, row.account.subgroup?.name, row.account.type)
        ));
    }, [data, isCompare, hideZero, accountTypes, search]);

    const sumOf = (rows: TBRow[], key: 'debit_balance' | 'credit_balance') => (
        rows.reduce((sum, row) => sum + Number(row[key] || 0), 0)
    );

    const printCopy = t.accounting.reports.print;

    /**
     * The totals row: the server's balance totals, and the gross columns over
     * every row it sent — hide-zero leaves those standing, as it leaves the
     * balances tied. A type or search narrows all four to the rows shown, as
     * the printed copy does.
     */
    const footerTotals = useMemo(() => {
        const rows = isCompare ? [] : ((data?.rows ?? []) as TBRow[]);
        const sum = (list: TBRow[], key: keyof Pick<TBRow, 'debit_total' | 'credit_total' | 'debit_balance' | 'credit_balance'>) => (
            list.reduce((total, row) => total + Number(row[key] || 0), 0)
        );
        if (narrowed || !data || isCompare) {
            return {
                debitTotal: sum(visibleRows, 'debit_total'),
                creditTotal: sum(visibleRows, 'credit_total'),
                debitBalance: sum(visibleRows, 'debit_balance'),
                creditBalance: sum(visibleRows, 'credit_balance'),
            };
        }
        return {
            debitTotal: sum(rows, 'debit_total'),
            creditTotal: sum(rows, 'credit_total'),
            debitBalance: Number(data.totals.debit),
            creditBalance: Number(data.totals.credit),
        };
    }, [data, isCompare, narrowed, visibleRows]);

    const handlePrint = useCallback(async () => {
        if (!data || isCompare) return;

        // Resolve on click rather than on mount: the template is only needed by
        // the people who actually print, and this page loads for everyone.
        // One branch prints on that branch's paper; company and compare do not.
        const [header, chosenPaper] = await Promise.all([
            printHeader.resolve(scope === 'branch' && storeId ? storeId : undefined),
            resolvePrintPaper(),
        ]);
        // The paper Print settings chose on this browser; a statement has no
        // roll layout, so a till roll prints it on A4.
        const paper = sheetPaper(chosenPaper);

        printTrialBalanceReport(
            {
                businessName,
                headerConfig: header.headerConfig,
                title: t.accounting.reports.trialBalance.title,
                periodLabel: t.accounting.reports.balanceSheet.asOf,
                periodValue: data.as_of,
                contextLines: reportContextLines(
                    {
                        scope,
                        storeName: stores.find((store) => store.id === storeId)?.name,
                        level,
                        levelLabel: rowLabel,
                        approvedOnly,
                        approvalEnabled,
                    },
                    printCopy,
                ),
                statusNote: data.is_balanced ? t.accountingShared.balanced : t.accountingShared.notBalanced,
                locale,
                generatedLabel: printCopy.generated,
                generatedAt: formatDateTime(new Date(), locale),
            },
            // `visibleRows`, so the printed copy honours the chips the same way
            // the table does. Hide-zero leaves the server's totals standing; a
            // type or search narrows them to the rows printed.
            visibleRows.map((row) => ({
                code: row.account.code ?? '',
                name: row.account.name,
                group: isRolledUp ? undefined : row.account.group.name,
                type: row.account.type,
                debitTotal: row.debit_total,
                creditTotal: row.credit_total,
                debitBalance: row.debit_balance,
                creditBalance: row.credit_balance,
            })),
            narrowed
                ? { debit: sumOf(visibleRows, 'debit_balance'), credit: sumOf(visibleRows, 'credit_balance') }
                : { debit: data.totals.debit as number, credit: data.totals.credit as number },
            {
                code: t.coa.columns.code,
                account: rowLabel,
                type: t.accountingShared.type,
                grossDebit: printCopy.grossDebit,
                grossCredit: printCopy.grossCredit,
                debitBalance: printCopy.debitBalance,
                creditBalance: printCopy.creditBalance,
                totals: t.accountingShared.totals,
                noRows: printCopy.noRows,
            },
            paper,
        );
    }, [
        data, isCompare, printHeader, businessName, t, scope, stores, storeId, level, rowLabel,
        approvedOnly, approvalEnabled, printCopy, locale, visibleRows, isRolledUp, narrowed,
    ]);

    const columns: ColumnDef<TBRow, any>[] = useMemo(() => [
        columnHelper.accessor((row) => row.account.code ?? '', {
            id: 'code',
            header: t.coa.columns.code,
            cell: (info) => <span className="font-mono text-xs text-gray-500">{info.getValue() || '—'}</span>,
            size: 90,
        }),
        columnHelper.accessor((row) => row.account.name, {
            id: 'account',
            header: rowLabel,
            cell: (info) => (
                <div className="min-w-0">
                    <span className="font-medium text-gray-800">{info.getValue()}</span>
                    {activeLevel !== 'group' && info.row.original.account.group?.name ? (
                        <span className="block text-xs text-gray-400">{info.row.original.account.group.name}</span>
                    ) : null}
                </div>
            ),
            size: 260,
        }),
        columnHelper.accessor((row) => row.account.type, {
            id: 'type',
            header: t.accountingShared.type,
            cell: (info) => <span className="text-xs text-gray-500">{accountTypeLabel(info.getValue())}</span>,
            meta: { hideOnMobile: true },
            size: 110,
        }),
        columnHelper.accessor('debit_total', {
            header: printCopy.grossDebit,
            cell: (info) => <span className="text-gray-700">{formatBDT(info.getValue(), { locale })}</span>,
            footer: () => formatBDT(footerTotals.debitTotal, { locale }),
            meta: { align: 'end', hideOnMobile: true },
            size: 140,
        }),
        columnHelper.accessor('credit_total', {
            header: printCopy.grossCredit,
            cell: (info) => <span className="text-gray-700">{formatBDT(info.getValue(), { locale })}</span>,
            footer: () => formatBDT(footerTotals.creditTotal, { locale }),
            meta: { align: 'end', hideOnMobile: true },
            size: 140,
        }),
        columnHelper.accessor('debit_balance', {
            header: printCopy.debitBalance,
            cell: (info) => <span className="font-medium text-gray-800">{info.getValue() > 0 ? formatBDT(info.getValue(), { locale }) : '—'}</span>,
            footer: () => formatBDT(footerTotals.debitBalance, { locale }),
            meta: { align: 'end' },
            size: 140,
        }),
        columnHelper.accessor('credit_balance', {
            header: printCopy.creditBalance,
            cell: (info) => <span className="font-medium text-gray-800">{info.getValue() > 0 ? formatBDT(info.getValue(), { locale }) : '—'}</span>,
            footer: () => formatBDT(footerTotals.creditBalance, { locale }),
            meta: { align: 'end' },
            size: 140,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [t, locale, rowLabel, activeLevel, printCopy, footerTotals]);

    const filters = useMemo<ResolvedListFilter[]>(() => {
        const list: ResolvedListFilter[] = [
            // A trial balance is always as of some day: cleared, it is today.
            asOfFilter({
                label: t.accounting.reports.balanceSheet.asOf,
                value: asOfDate,
                onChange: setAsOfDate,
                fallback: defaultToday,
            }) as ResolvedListFilter,
            {
                id: 'level',
                type: 'select',
                label: t.accounting.reports.reportLevel.detail,
                value: level,
                onChange: (next) => {
                    const nextLevel = (next as ReportLevelMode | null) ?? 'account';
                    persistReportLevel(nextLevel);
                    setLevel(nextLevel);
                },
                options: REPORT_LEVEL_MODES.map((mode) => ({ value: mode, label: t.accounting.reports.reportLevel[mode] })),
            },
        ];
        if (!compare) {
            list.push(
                {
                    id: 'accountType',
                    type: 'multi-select',
                    label: ui.trialBalance.accountType,
                    value: accountTypes,
                    onChange: setAccountTypes,
                    options: ACCOUNT_TYPES.map((type) => ({ value: type, label: accountTypeLabel(type) })),
                },
                {
                    id: 'hideZero',
                    type: 'toggle',
                    label: t.accountingShared.hideZeroBalances,
                    pressed: hideZero,
                    onChange: (next) => {
                        persistHideZero(next);
                        setHideZero(next);
                    },
                },
            );
        }
        if (canConsolidate) {
            list.push({
                id: 'compare',
                type: 'toggle',
                label: t.accounting.reports.reportScope.compareBranches,
                pressed: compare,
                onChange: (next) => {
                    persistCompare(next);
                    setCompare(next);
                },
            });
            if (compare) {
                list.push(
                    {
                        id: 'branches',
                        type: 'multi-select',
                        label: ui.trialBalance.branches,
                        value: selectedStoreIds,
                        // A comparison needs at least one branch.
                        onChange: (next) => {
                            if (next.length > 0) setSelectedStoreIds(next);
                        },
                        options: stores.map((store) => ({ value: store.id, label: store.name })),
                    },
                    {
                        id: 'companyOverhead',
                        type: 'toggle',
                        label: t.accounting.reports.reportScope.companyOverhead,
                        pressed: includeCompanyBucket,
                        onChange: setIncludeCompanyBucket,
                        more: true,
                    },
                );
            }
        }
        if (approvalEnabled) {
            list.push({
                id: 'approvedOnly',
                type: 'toggle',
                label: t.accountingShared.approvedOnly,
                pressed: approvedOnly,
                onChange: setApprovedOnly,
                control: 'checkbox',
                more: true,
            });
        }
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        t, ui, asOfDate, level, compare, accountTypes, hideZero, canConsolidate, selectedStoreIds, stores,
        includeCompanyBucket, approvalEnabled, approvedOnly,
    ]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const debit = sumOf(visibleRows, 'debit_balance');
        const credit = sumOf(visibleRows, 'credit_balance');
        // Whether the books balance is the whole trial's, not the rows on screen.
        const serverDebit = Number(data && !isCompare ? data.totals.debit : 0);
        const serverCredit = Number(data && !isCompare ? data.totals.credit : 0);
        const difference = Math.abs(serverDebit - serverCredit);
        const balanced = data ? (data.is_balanced ?? difference < 0.005) : true;
        const items: ListStat[] = [
            { id: 'debit', icon: <ArrowDownLeft aria-hidden />, label: ui.common.totalDebit, value: data ? money(debit) : '—' },
            { id: 'credit', icon: <ArrowUpRight aria-hidden />, label: ui.common.totalCredit, value: data ? money(credit) : '—' },
            {
                id: 'difference',
                icon: <Scale aria-hidden />,
                label: t.accountingShared.difference,
                value: data ? money(difference) : '—',
                hint: data ? (balanced ? t.accountingShared.balanced : t.accountingShared.notBalanced) : undefined,
                tone: data && !balanced ? 'warning' : 'default',
            },
            {
                id: 'rows',
                icon: <Hash aria-hidden />,
                label: activeLevel === 'account' ? ui.trialBalance.accounts : ui.trialBalance.rows,
                value: visibleRows.length.toLocaleString(locale),
            },
        ];
        return { items, loading: loading && !data, label: ui.trialBalance.statsLabel };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleRows, data, isCompare, loading, locale, t, ui, activeLevel]);

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={t.accounting.reports.trialBalance.title}
                subtitle={t.accounting.reports.trialBalance.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.accounting.reports.trialBalance.title,
                    'accounting',
                )}
                actions={(
                    <>
                        {compare ? null : <BranchFilter scope={branch} />}
                        <ReportPrintButton
                            onPrint={() => void handlePrint()}
                            disabled={!data || loading || isCompare}
                            disabledReason={isCompare ? printCopy.unavailableInCompare : undefined}
                        />
                    </>
                )}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {compare ? (
                <>
                    <ListToolbar tableId="trial-balance-compare" filters={filters} filterLayout="row" viewOptions={false} />
                    {loading ? (
                        <div className="rounded-lg border border-gray-100 bg-white py-8 text-center text-sm text-gray-400">
                            {t.accountingShared.loading}
                        </div>
                    ) : data && isCompare && data.columns ? (
                        <CompareMatrixTable
                            columns={data.columns}
                            variant="trialBalance"
                            trialBalanceRows={data.rows as CompareTrialBalanceRow[]}
                            totals={{
                                debit: data.totals.debit as Record<string, number>,
                                credit: data.totals.credit as Record<string, number>,
                            }}
                        />
                    ) : null}
                </>
            ) : (
                <>
                    <DataTable<TBRow>
                        tableId="accounting-trial-balance"
                        title={t.accounting.reports.trialBalance.title}
                        columns={columns}
                        data={visibleRows}
                        getRowId={(row) => row.account.id}
                        isLoading={loading}
                        emptyMessage={printCopy.noRows}
                        searchPlaceholder={ui.trialBalance.searchPlaceholder}
                        searchValue={search}
                        onSearchChange={setSearch}
                        filters={filters as ListFilter[]}
                        filterLayout="row"
                        stats={stats}
                        enableColumnFilters={false}
                        viewOptions
                        footerLabel={t.accountingShared.totals}
                        // The header's Print prints the statement with its
                        // totals; a plain-table print beside it would be a
                        // second, lesser copy of the same thing.
                        showPrint={false}
                    />
                    {isRolledUp && data ? (
                        <p className="text-xs text-gray-500">{t.accounting.reports.reportLevel.nettingHint}</p>
                    ) : null}
                </>
            )}
        </AccountingPageShell>
    );
}
