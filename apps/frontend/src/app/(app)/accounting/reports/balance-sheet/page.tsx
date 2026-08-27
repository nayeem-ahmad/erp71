'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
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
import { getWorkspaceItem } from '@/lib/session-store';

type Group = StatementGroup;

interface BSData {
    scope?: string;
    level?: ReportLevelMode;
    as_of: string;
    assets?: { groups: Group[]; total: number };
    liabilities?: { groups: Group[]; total: number };
    equity?: { groups: Group[]; net_profit: number; total: number };
    total_liabilities_and_equity?: number;
    is_balanced?: boolean;
    columns?: Array<{ key: string; label: string; type?: string }>;
    sections?: CompareMatrixSection[];
    net_profit?: Record<string, number>;
    total_assets?: Record<string, number>;
    totals?: Record<string, number>;
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

export default function BalanceSheetPage() {
    const { t, locale } = useI18n();
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('LIST_REPORT');
    const { stores, canConsolidate, loading: storesLoading } = useReportStores();
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [data, setData] = useState<BSData | null>(null);
    const [scope, setScope] = useState<ReportScopeMode>('branch');
    const [level, setLevel] = useState<ReportLevelMode>('account');
    const [storeId, setStoreId] = useState('');
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [includeCompanyBucket, setIncludeCompanyBucket] = useState(false);
    const [hideZero, setHideZero] = useState(false);
    const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
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
            const result = await api.getBalanceSheet({
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
                title: t.accounting.reports.balanceSheet.title,
                periodLabel: t.accounting.reports.balanceSheet.asOf,
                periodValue: data.as_of,
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
                statusNote: data.is_balanced ? t.accountingShared.balanced : t.accountingShared.notBalanced,
                locale,
                generatedLabel: printCopy.generated,
                generatedAt: new Date().toLocaleString(locale),
            },
            [
                {
                    label: t.accounting.reports.assets,
                    // The printed copy honours hide-zero, so it matches the screen.
                    groups: hideZeroGroups(data.assets?.groups ?? [], hideZero),
                    totalLabel: t.accounting.reports.totalAssets,
                    total: data.assets?.total ?? 0,
                },
                {
                    label: t.accounting.reports.liabilities,
                    groups: hideZeroGroups(data.liabilities?.groups ?? [], hideZero),
                    totalLabel: t.accounting.reports.totalLiabilities,
                    total: data.liabilities?.total ?? 0,
                },
                {
                    label: t.accounting.reports.equity,
                    groups: hideZeroGroups(data.equity?.groups ?? [], hideZero),
                    totalLabel: t.accounting.reports.totalEquity,
                    total: data.equity?.total ?? 0,
                },
            ],
            [
                {
                    // Sits outside the equity groups on screen too — it is the
                    // period's result, not a posted equity account.
                    label: t.accounting.reports.currentPeriodNetProfit,
                    amount: data.equity?.net_profit ?? 0,
                },
                {
                    label: t.accounting.reports.totalLiabilitiesAndEquity,
                    amount: data.total_liabilities_and_equity ?? 0,
                    strong: true,
                },
            ],
            { account: printCopy.account, amount: printCopy.amount, noRows: printCopy.noRows },
        );
    }, [
        data, isCompare, printHeader, businessName, t, scope, stores, storeId, level,
        approvedOnly, approvalEnabled, printCopy, locale, hideZero,
    ]);

    return (
        <AccountingPageShell maxWidth={isCompare ? 'full' : 'narrow'}>
            <PageHeader
                title={t.accounting.reports.balanceSheet.title}
                subtitle={t.accounting.reports.balanceSheet.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.accounting.reports.balanceSheet.title,
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
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">{t.accountingShared.loading}</CompactSection>
            ) : data ? (
                isCompare && data.columns && data.sections ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
                            <span>{t.accounting.reports.balanceSheet.asOf} {data.as_of}</span>
                        </div>
                        <CompareMatrixTable
                            columns={data.columns}
                            sections={data.sections}
                            footerRows={[
                                ...(data.net_profit ? [{
                                    label: t.accounting.reports.currentPeriodNetProfit,
                                    amounts: data.net_profit,
                                    emphasis: 'profit' as const,
                                }] : []),
                                ...(data.total_assets ? [{
                                    label: t.accounting.reports.totalAssets,
                                    amounts: data.total_assets,
                                    emphasis: 'default' as const,
                                }] : []),
                                ...(data.totals ? [{
                                    label: t.accounting.reports.totalLiabilitiesAndEquity,
                                    amounts: data.totals,
                                    emphasis: 'total' as const,
                                }] : []),
                            ]}
                        />
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
                            {data.is_balanced
                                ? <><CheckCircle className="w-4 h-4 text-emerald-500" /><span className="text-emerald-700">{t.accountingShared.balanced}</span></>
                                : <><AlertCircle className="w-4 h-4 text-amber-500" /><span className="text-amber-700">{t.accountingShared.notBalanced}</span></>
                            }
                            <span className="ms-2">{t.accounting.reports.balanceSheet.asOf} {data.as_of}</span>
                        </div>

                        <div className="grid md:grid-cols-2 gap-3">
                            <CompactSection className="space-y-3">
                                <StatementSection groups={hideZeroGroups(data.assets?.groups ?? [], hideZero)} label={t.accounting.reports.assets} colorClass="bg-sky-50 text-sky-700" />
                                <div className="flex justify-between items-center px-3 py-2 bg-sky-50 rounded-lg font-semibold text-sm text-sky-800 border border-sky-100">
                                    <span>{t.accounting.reports.totalAssets}</span>
                                    <span>{formatBDT(data.assets?.total ?? 0, { locale })}</span>
                                </div>
                            </CompactSection>

                            <div className="space-y-3">
                                <CompactSection className="space-y-3">
                                    <StatementSection groups={hideZeroGroups(data.liabilities?.groups ?? [], hideZero)} label={t.accounting.reports.liabilities} colorClass="bg-danger-light text-danger-text" />
                                    <div className="flex justify-between items-center px-3 py-2 bg-danger-light rounded-lg font-semibold text-sm text-danger-text border border-red-100">
                                        <span>{t.accounting.reports.totalLiabilities}</span>
                                        <span>{formatBDT(data.liabilities?.total ?? 0, { locale })}</span>
                                    </div>
                                </CompactSection>

                                <CompactSection className="space-y-3">
                                    <StatementSection groups={hideZeroGroups(data.equity?.groups ?? [], hideZero)} label={t.accounting.reports.equity} colorClass="bg-primary-light text-blue-700" />
                                    <div className="flex justify-between items-center px-5 py-1 text-sm text-gray-600">
                                        <span>{t.accounting.reports.currentPeriodNetProfit}</span>
                                        <span className={(data.equity?.net_profit ?? 0) >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                                            {formatBDT(data.equity?.net_profit ?? 0, { locale })}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center px-3 py-2 bg-primary-light rounded-lg font-semibold text-sm text-blue-800 border border-primary-border">
                                        <span>{t.accounting.reports.totalEquity}</span>
                                        <span>{formatBDT(data.equity?.total ?? 0, { locale })}</span>
                                    </div>
                                </CompactSection>

                                <div className="flex justify-between items-center px-4 py-3 bg-gray-900 text-white rounded-lg font-semibold text-sm">
                                    <span>{t.accounting.reports.totalLiabilitiesAndEquity}</span>
                                    <span>{formatBDT(data.total_liabilities_and_equity ?? 0, { locale })}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            ) : null}
        </AccountingPageShell>
    );
}