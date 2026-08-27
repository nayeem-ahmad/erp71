'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import ReportScopeBar from '@/components/accounting/ReportScopeBar';
import CompareMatrixTable, { type CompareTrialBalanceRow } from '@/components/accounting/CompareMatrixTable';
import ReportPrintButton from '@/components/accounting/ReportPrintButton';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { printTrialBalanceReport, reportContextLines } from '@/lib/statement-printer';
import {
    getDefaultHideZero,
    getDefaultReportLevel,
    getDefaultReportScope,
    type ReportLevelMode,
    type ReportScopeMode,
    useReportStores,
    useApprovedOnly,
} from '@/lib/accounting-report-scope';
import { getWorkspaceItem } from '@/lib/session-store';

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

function buildScopeParams(
    scope: ReportScopeMode,
    storeId: string,
    selectedStoreIds: string[],
    includeCompanyBucket: boolean,
) {
    if (scope === 'branch') {
        return { scope, storeId };
    }
    if (scope === 'compare') {
        return { scope, storeIds: selectedStoreIds, includeCompanyBucket };
    }
    return { scope: 'company' as const };
}

const thClass = `text-end px-3 py-2 ${compactDensity.formLabel}`;
const thLeftClass = `text-start px-3 py-2 ${compactDensity.formLabel}`;

export default function TrialBalancePage() {
    const { t, locale } = useI18n();
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('LIST_REPORT');
    const { stores, canConsolidate, loading: storesLoading } = useReportStores();
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [data, setData] = useState<TBData | null>(null);
    const [scope, setScope] = useState<ReportScopeMode>('branch');
    const [level, setLevel] = useState<ReportLevelMode>('account');
    const [storeId, setStoreId] = useState('');
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [includeCompanyBucket, setIncludeCompanyBucket] = useState(false);
    const [hideZero, setHideZero] = useState(false);
    const [asOfDate, setAsOfDate] = useState(defaultToday());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (storesLoading || stores.length === 0) {
            return;
        }

        const savedStoreId = getWorkspaceItem('store_id');
        const resolvedStoreId = stores.some((store) => store.id === savedStoreId)
            ? (savedStoreId as string)
            : stores[0].id;

        setStoreId(resolvedStoreId);
        setSelectedStoreIds(stores.map((store) => store.id));
        setScope(getDefaultReportScope(stores.length, canConsolidate));
        setLevel(getDefaultReportLevel());
        setHideZero(getDefaultHideZero());
        setInitialized(true);
    }, [stores, storesLoading, canConsolidate]);

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
                ...buildScopeParams(scope, storeId, selectedStoreIds, includeCompanyBucket),
            });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? t.accounting.reports.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [asOfDate, scope, level, storeId, selectedStoreIds, includeCompanyBucket, initialized, approvalReady, approvedOnly, t.accounting.reports.loadFailed]);

    useEffect(() => {
        if (initialized && approvalReady) {
            void load();
        }
    }, [initialized, approvalReady, load]);

    const isCompare = data?.scope === 'compare';
    const activeLevel = data?.level ?? 'account';
    const isRolledUp = activeLevel !== 'account';
    const rowLabel = t.accounting.reports.reportLevel[activeLevel];

    // Zero means the closing balance nets out. Only the two balance columns are
    // totalled in the footer, so dropping such a row never leaves a column that
    // fails to tie.
    const visibleRows = useMemo(() => {
        const rows = (data?.rows ?? []) as TBRow[];
        return hideZero ? rows.filter((row) => Math.abs(row.closing_balance) >= 0.005) : rows;
    }, [data, hideZero]);

    const printCopy = t.accounting.reports.print;

    const handlePrint = useCallback(async () => {
        if (!data || isCompare) return;

        // Resolve on click rather than on mount: the template is only needed by
        // the people who actually print, and this page loads for everyone.
        const header = await printHeader.resolve();

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
                generatedAt: new Date().toLocaleString(locale),
            },
            // `visibleRows`, so the printed copy honours hide-zero the same way
            // the table does — the footer totals are the server's either way.
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
            { debit: data.totals.debit as number, credit: data.totals.credit as number },
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
        );
    }, [
        data, isCompare, printHeader, businessName, t, scope, stores, storeId, level, rowLabel,
        approvedOnly, approvalEnabled, printCopy, locale, visibleRows, isRolledUp,
    ]);

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
            />
            <AccountingToolbar
                actions={(
                    <ReportPrintButton
                        onPrint={() => void handlePrint()}
                        disabled={!data || loading || isCompare}
                        disabledReason={isCompare ? printCopy.unavailableInCompare : undefined}
                    />
                )}
            >
                <ReportScopeBar
                    scope={scope}
                    onScopeChange={setScope}
                    storeId={storeId}
                    onStoreIdChange={setStoreId}
                    selectedStoreIds={selectedStoreIds}
                    onSelectedStoreIdsChange={setSelectedStoreIds}
                    includeCompanyBucket={includeCompanyBucket}
                    onIncludeCompanyBucketChange={setIncludeCompanyBucket}
                    stores={stores}
                    canConsolidate={canConsolidate}
                    dateMode="asOf"
                    from={asOfDate}
                    to={asOfDate}
                    asOfDate={asOfDate}
                    onDateChange={(field, value) => {
                        if (field === 'asOfDate') {
                            setAsOfDate(value);
                        }
                    }}
                    onGenerate={() => void load()}
                    generating={loading}
                    level={level}
                    onLevelChange={setLevel}
                    approvedOnly={approvedOnly}
                    onApprovedOnlyChange={setApprovedOnly}
                    approvalEnabled={approvalEnabled}
                    hideZero={hideZero}
                    onHideZeroChange={setHideZero}
                />
                {!isCompare && data ? (
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${data.is_balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {data.is_balanced ? t.accountingShared.balanced : t.accountingShared.notBalanced}
                    </span>
                ) : null}
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">{t.accountingShared.loading}</CompactSection>
            ) : data ? (
                isCompare && data.columns ? (
                    <CompareMatrixTable
                        columns={data.columns}
                        variant="trialBalance"
                        trialBalanceRows={data.rows as CompareTrialBalanceRow[]}
                        totals={{
                            debit: data.totals.debit as Record<string, number>,
                            credit: data.totals.credit as Record<string, number>,
                        }}
                    />
                ) : (
                    <CompactSection className="p-0 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                    <th className={`${thLeftClass} w-20`}>{t.coa.columns.code}</th>
                                    <th className={thLeftClass}>{rowLabel}</th>
                                    <th className={thLeftClass}>{t.accountingShared.type}</th>
                                    <th className={thClass}>Gross Debit</th>
                                    <th className={thClass}>Gross Credit</th>
                                    <th className={thClass}>Debit Balance</th>
                                    <th className={thClass}>Credit Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRows.map((row) => (
                                    <tr key={row.account.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                        <td className="px-3 py-2 font-mono text-xs text-gray-500">
                                            {row.account.code || '—'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className="font-medium text-gray-800">{row.account.name}</span>
                                            {activeLevel !== 'group' && (
                                                <div className="text-xs text-gray-400">{row.account.group.name}</div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-500">{row.account.type}</td>
                                        <td className="px-3 py-2 text-end text-gray-700">{formatBDT(row.debit_total, { locale })}</td>
                                        <td className="px-3 py-2 text-end text-gray-700">{formatBDT(row.credit_total, { locale })}</td>
                                        <td className="px-3 py-2 text-end font-medium text-gray-800">{row.debit_balance > 0 ? formatBDT(row.debit_balance, { locale }) : '—'}</td>
                                        <td className="px-3 py-2 text-end font-medium text-gray-800">{row.credit_balance > 0 ? formatBDT(row.credit_balance, { locale }) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                                    <td className="px-3 py-2 text-xs" colSpan={5}>{t.accountingShared.totals}</td>
                                    <td className="px-3 py-2 text-end text-gray-900">{formatBDT(data.totals.debit as number, { locale })}</td>
                                    <td className="px-3 py-2 text-end text-gray-900">{formatBDT(data.totals.credit as number, { locale })}</td>
                                </tr>
                            </tfoot>
                        </table>
                        {isRolledUp && (
                            <p className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100">
                                {t.accounting.reports.reportLevel.nettingHint}
                            </p>
                        )}
                    </CompactSection>
                )
            ) : null}
        </AccountingPageShell>
    );
}