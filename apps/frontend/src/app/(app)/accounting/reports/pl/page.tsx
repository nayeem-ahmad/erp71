'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import ReportScopeBar from '@/components/accounting/ReportScopeBar';
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
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { printStatementReport, reportContextLines } from '@/lib/statement-printer';
import {
    getDefaultHideZero,
    getDefaultReportLevel,
    getDefaultReportScope,
    type ReportLevelMode,
    type ReportScopeMode,
    useReportStores,
    useApprovedOnly,
} from '@/lib/accounting-report-scope';

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

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

export default function ProfitLossPage() {
    const { t, locale } = useI18n();
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('LIST_REPORT');
    const { stores, canConsolidate, loading: storesLoading } = useReportStores();
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [data, setData] = useState<PLData | null>(null);
    const [scope, setScope] = useState<ReportScopeMode>('branch');
    const [level, setLevel] = useState<ReportLevelMode>('account');
    const [storeId, setStoreId] = useState('');
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [includeCompanyBucket, setIncludeCompanyBucket] = useState(false);
    const [hideZero, setHideZero] = useState(false);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (storesLoading || stores.length === 0) {
            return;
        }

        const savedStoreId = localStorage.getItem('store_id');
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
            const result = await api.getProfitLoss({
                approvedOnly,
                from: fromDate || undefined,
                to: toDate || undefined,
                level,
                ...buildScopeParams(scope, storeId, selectedStoreIds, includeCompanyBucket),
            });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? t.accounting.reports.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [fromDate, toDate, scope, level, storeId, selectedStoreIds, includeCompanyBucket, initialized, approvalReady, approvedOnly, t.accounting.reports.loadFailed]);

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
        const header = await printHeader.resolve();

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
                generatedAt: new Date().toLocaleString(locale),
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
        );
    }, [
        data, isCompare, printHeader, businessName, t, period, scope, stores, storeId, level,
        approvedOnly, approvalEnabled, printCopy, locale, hideZero, isProfit, netProfitValue,
    ]);

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
                    dateMode="range"
                    from={fromDate}
                    to={toDate}
                    asOfDate={toDate}
                    onDateChange={(field, value) => {
                        if (field === 'from') setFromDate(value);
                        if (field === 'to') setToDate(value);
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
            </AccountingToolbar>

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
                            sections={data.sections}
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

                        <StatementSection groups={hideZeroGroups(data.revenue.groups, hideZero)} label={t.accounting.reports.revenue} colorClass="bg-emerald-50 text-emerald-700" />

                        <div className="flex justify-between items-center px-3 py-2 bg-emerald-50 rounded-lg font-semibold text-sm text-emerald-800 border border-emerald-100">
                            <span>{t.accounting.reports.totalRevenue}</span>
                            <span>{formatBDT(data.revenue.total, { locale })}</span>
                        </div>

                        <StatementSection groups={hideZeroGroups(data.expenses.groups, hideZero)} label={t.accounting.reports.expenses} colorClass="bg-danger-light text-danger-text" />

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