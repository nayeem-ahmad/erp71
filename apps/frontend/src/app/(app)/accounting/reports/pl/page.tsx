'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Percent, Receipt, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import {
    AccountingPageShell,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { ListStats, ListToolbar, type ListFilter, type ListStat, type ResolvedListFilter } from '@/components/data-table';
import CompareMatrixTable, { type CompareMatrixSection } from '@/components/accounting/CompareMatrixTable';
import StatementSection, {
    hideZeroGroups,
    type StatementGroup,
} from '@/components/accounting/StatementSection';
import ReportPrintButton from '@/components/accounting/ReportPrintButton';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { formatBDT, formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { sheetPaper } from '@/lib/print';
import { resolvePrintPaper } from '@/lib/hooks/useSalePrintPrefs';
import { printStatementReport, reportContextLines } from '@/lib/statement-printer';
import {
    getDefaultHideZero,
    getDefaultReportLevel,
    getDefaultCompare,
    type ReportLevelMode,
    statementScopeParams,
    useApprovedOnly,
} from '@/lib/accounting-report-scope';
import { BranchFilter, Button } from '@/components/ui';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import type { CreatedRange } from '@/lib/created-range';
import {
    PERIOD_PRESETS,
    defaultPeriod,
    requiredPeriod,
    searchCompareSections,
    searchStatementGroups,
    signedPercent,
    statementScopeFilters,
    totalFigure,
    wholeTaka,
} from '../_shared/report-chips';

type Group = StatementGroup;

interface PLData {
    scope?: string;
    level?: ReportLevelMode;
    filters?: { from: string; to: string };
    period?: { from: string; to: string };
    revenue: { groups: Group[]; total: number };
    expenses: { groups: Group[]; total: number };
    net_profit: number | Record<string, number>;
    columns?: Array<{ key: string; label: string; type?: string }>;
    sections?: CompareMatrixSection[];
}

export default function ProfitLossPage() {
    const { t, locale } = useI18n();
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('LIST_REPORT');
    // Which branch, or the whole company, is the page's branch filter;
    // "Compare branches" (consolidated viewers only) overrides it.
    const branch = useBranchScope();
    const stores = branch.branches;
    const canConsolidate = branch.canSeeAll;
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [data, setData] = useState<PLData | null>(null);
    const [compare, setCompare] = useState(false);
    const [level, setLevel] = useState<ReportLevelMode>('account');
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [includeCompanyBucket, setIncludeCompanyBucket] = useState(false);
    const [hideZero, setHideZero] = useState(false);
    const [periodRange, setPeriodRange] = useState<CreatedRange>(defaultPeriod);
    const fromDate = periodRange.from ?? '';
    const toDate = periodRange.to ?? '';
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [initialized, setInitialized] = useState(false);

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
            const result = await api.getProfitLoss({
                approvedOnly,
                from: fromDate || undefined,
                to: toDate || undefined,
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
    }, [fromDate, toDate, compare, branch.value, level, selectedStoreIds, includeCompanyBucket, initialized, approvalReady, approvedOnly, t.accounting.reports.loadFailed]);

    useEffect(() => {
        if (initialized && approvalReady) {
            void load();
        }
    }, [initialized, approvalReady, load]);

    const isCompare = data?.scope === 'compare';
    const period = data?.period ?? data?.filters;
    const netProfitValue = typeof data?.net_profit === 'number'
        ? data.net_profit
        : (data?.net_profit?.total ?? 0);
    const isProfit = netProfitValue >= 0;

    const printCopy = t.accounting.reports.print;

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

        printStatementReport(
            {
                businessName,
                headerConfig: header.headerConfig,
                title: t.accounting.reports.pl.title,
                periodLabel: t.accountingShared.period,
                periodValue: period ? `${period.from} — ${period.to}` : '—',
                contextLines: reportContextLines(
                    {
                        scope,
                        storeName: stores.find((store) => store.id === storeId)?.name,
                        level,
                        levelLabel: t.accounting.reports.reportLevel[level],
                        approvedOnly,
                        approvalEnabled,
                    },
                    printCopy,
                ),
                locale,
                generatedLabel: printCopy.generated,
                generatedAt: formatDateTime(new Date(), locale),
            },
            [
                {
                    label: t.accounting.reports.revenue,
                    // The printed copy honours hide-zero, so it matches the screen.
                    groups: hideZeroGroups(data.revenue.groups, hideZero),
                    totalLabel: t.accounting.reports.totalRevenue,
                    total: data.revenue.total,
                },
                {
                    label: t.accounting.reports.expenses,
                    groups: hideZeroGroups(data.expenses.groups, hideZero),
                    totalLabel: t.accounting.reports.totalExpenses,
                    total: data.expenses.total,
                },
            ],
            [
                {
                    label: isProfit ? t.accounting.reports.netProfit : t.accounting.reports.netLoss,
                    amount: Math.abs(netProfitValue),
                    strong: true,
                },
            ],
            { account: printCopy.account, amount: printCopy.amount, noRows: printCopy.noRows },
            paper,
        );
    }, [
        data, isCompare, printHeader, businessName, t, period, scope, stores, storeId, level,
        approvedOnly, approvalEnabled, printCopy, locale, hideZero, isProfit, netProfitValue,
    ]);

    const filters = useMemo<ResolvedListFilter[]>(() => {
        const list: ListFilter[] = [
            {
                id: 'period',
                type: 'date-range',
                label: t.accountingShared.period,
                value: periodRange,
                // A statement is always for some period: cleared, it goes back to this month.
                onChange: (next) => setPeriodRange(requiredPeriod(next)),
                presets: PERIOD_PRESETS,
                operators: true,
            },
            ...statementScopeFilters(t, {
                canConsolidate,
                compare,
                onCompareChange: setCompare,
                stores,
                selectedStoreIds,
                onSelectedStoreIdsChange: setSelectedStoreIds,
                includeCompanyBucket,
                onIncludeCompanyBucketChange: setIncludeCompanyBucket,
                level,
                onLevelChange: setLevel,
                hideZero,
                onHideZeroChange: setHideZero,
                approvalEnabled,
                approvedOnly,
                onApprovedOnlyChange: setApprovedOnly,
            }),
        ];
        return list as ResolvedListFilter[];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, periodRange, canConsolidate, compare, stores, selectedStoreIds, includeCompanyBucket, level, hideZero, approvalEnabled, approvedOnly]);

    // The figures of the statement on screen: its own totals, or the "total"
    // column of a branch comparison.
    const stats = useMemo(() => {
        const revenueTotal = isCompare ? totalFigure(data?.sections?.[0]?.subtotals) : (data?.revenue?.total ?? 0);
        const expenseTotal = isCompare ? totalFigure(data?.sections?.[1]?.subtotals) : (data?.expenses?.total ?? 0);
        const margin = revenueTotal !== 0 ? (netProfitValue / Math.abs(revenueTotal)) * 100 : null;
        const items: ListStat[] = [
            { id: 'revenue', icon: <Banknote aria-hidden />, label: t.accounting.reports.totalRevenue, value: wholeTaka(revenueTotal, locale) },
            { id: 'expenses', icon: <Receipt aria-hidden />, label: t.accounting.reports.totalExpenses, value: wholeTaka(expenseTotal, locale) },
            {
                id: 'net',
                icon: isProfit ? <TrendingUp aria-hidden /> : <TrendingDown aria-hidden />,
                label: isProfit ? t.accounting.reports.netProfit : t.accounting.reports.netLoss,
                value: wholeTaka(Math.abs(netProfitValue), locale),
                tone: isProfit ? 'default' : 'danger',
            },
            {
                id: 'margin',
                icon: <Percent aria-hidden />,
                label: t.accounting.reports.financialRatios.netMargin,
                value: signedPercent(margin) ?? '—',
                tone: margin !== null && margin < 0 ? 'danger' : 'default',
            },
        ];
        return items;
    }, [data, isCompare, isProfit, netProfitValue, locale, t]);

    const revenueGroups = useMemo(
        () => searchStatementGroups(hideZeroGroups(data?.revenue?.groups ?? [], hideZero), search),
        [data, hideZero, search],
    );
    const expenseGroups = useMemo(
        () => searchStatementGroups(hideZeroGroups(data?.expenses?.groups ?? [], hideZero), search),
        [data, hideZero, search],
    );
    const compareSections = useMemo(() => searchCompareSections(data?.sections ?? [], search), [data, search]);

    return (
        <AccountingPageShell maxWidth={isCompare ? 'full' : 'narrow'}>
            <PageHeader
                title={t.accounting.reports.pl.title}
                subtitle={t.accounting.reports.pl.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.accounting.reports.pl.title,
                    'accounting',
                )}
                actions={(
                    <>
                        {compare ? null : <BranchFilter scope={branch} />}
                        <Button
                            variant="secondary"
                            onClick={() => void load()}
                            disabled={loading || (compare && selectedStoreIds.length === 0)}
                        >
                            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                            {t.accounting.reports.reportScope.generate}
                        </Button>
                        <ReportPrintButton
                            onPrint={() => void handlePrint()}
                            disabled={!data || loading || isCompare}
                            disabledReason={isCompare ? printCopy.unavailableInCompare : undefined}
                        />
                    </>
                )}
            />

            <ListStats stats={stats} loading={loading || !data} label={t.accountingReportsUi.common.stats} />

            <ListToolbar
                tableId="accounting-profit-loss"
                filterLayout="row"
                viewOptions={false}
                filters={filters}
                search={{ value: search, onChange: setSearch, placeholder: t.accountingReportsUi.common.searchAccounts }}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">
                    {t.accountingShared.loading}
                </CompactSection>
            ) : data ? (
                isCompare && data.columns && data.sections ? (
                    <div className="space-y-3">
                        {period ? (
                            <div className="text-center border-b border-gray-100 pb-3">
                                <p className={compactDensity.sectionLabel}>{t.accountingShared.period}</p>
                                <p className="text-sm font-semibold text-gray-700 mt-1">{period.from} — {period.to}</p>
                            </div>
                        ) : null}
                        <CompareMatrixTable
                            columns={data.columns}
                            sections={compareSections}
                            footerRows={[
                                {
                                    label: isProfit ? t.accounting.reports.netProfit : t.accounting.reports.netLoss,
                                    amounts: typeof data.net_profit === 'object' ? data.net_profit : { total: data.net_profit },
                                    emphasis: 'profit',
                                },
                            ]}
                        />
                    </div>
                ) : (
                    <CompactSection className="space-y-4">
                        {period ? (
                            <div className="text-center border-b border-gray-100 pb-3">
                                <p className={compactDensity.sectionLabel}>{t.accountingShared.period}</p>
                                <p className="text-sm font-semibold text-gray-700 mt-1">{period.from} — {period.to}</p>
                            </div>
                        ) : null}

                        <StatementSection groups={revenueGroups} label={t.accounting.reports.revenue} colorClass="bg-emerald-50 text-emerald-700" />

                        <div className="flex justify-between items-center px-3 py-2 bg-emerald-50 rounded-lg font-semibold text-sm text-emerald-800 border border-emerald-100">
                            <span>{t.accounting.reports.totalRevenue}</span>
                            <span>{formatBDT(data.revenue.total, { locale })}</span>
                        </div>

                        <StatementSection groups={expenseGroups} label={t.accounting.reports.expenses} colorClass="bg-danger-light text-danger-text" />

                        <div className="flex justify-between items-center px-3 py-2 bg-danger-light rounded-lg font-semibold text-sm text-danger-text border border-red-100">
                            <span>{t.accounting.reports.totalExpenses}</span>
                            <span>{formatBDT(data.expenses.total, { locale })}</span>
                        </div>

                        <div className={`flex justify-between items-center px-4 py-3 rounded-lg font-semibold text-sm border ${isProfit ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
                            <div className="flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" />
                                <span>{isProfit ? t.accounting.reports.netProfit : t.accounting.reports.netLoss}</span>
                            </div>
                            <span>{formatBDT(Math.abs(netProfitValue), { locale })}</span>
                        </div>
                    </CompactSection>
                )
            ) : null}
        </AccountingPageShell>
    );
}
