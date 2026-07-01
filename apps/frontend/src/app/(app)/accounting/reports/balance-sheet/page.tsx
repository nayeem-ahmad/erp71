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
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import {
    getDefaultReportScope,
    type ReportScopeMode,
    useReportStores,
} from '@/lib/accounting-report-scope';

interface AccountRow {
    id: string;
    name: string;
    code?: string | null;
    subgroup?: { name: string } | null;
    balance: number;
}

interface Group {
    group: { id: string; name: string };
    accounts: AccountRow[];
    total: number;
}

interface BSData {
    scope?: string;
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

function BSSection({ groups, label, colorClass }: { groups: Group[]; label: string; colorClass: string }) {
    const { locale } = useI18n();
    return (
        <div>
            <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${colorClass} mb-2`}>
                {label}
            </div>
            {groups.map((g) => (
                <div key={g.group.id} className="mb-3">
                    <div className="flex justify-between items-center px-3 py-1.5 bg-gray-50 rounded-lg font-semibold text-sm text-gray-700">
                        <span>{g.group.name}</span>
                        <span>{formatBDT(g.total, { locale })}</span>
                    </div>
                    {g.accounts.map((a) => (
                        <div key={a.id} className="flex justify-between items-center px-5 py-1 text-sm text-gray-600">
                            <span>{a.name}{a.code ? <span className="ml-2 text-xs text-gray-400">{a.code}</span> : null}</span>
                            <span>{formatBDT(a.balance, { locale })}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export default function BalanceSheetPage() {
    const { t, locale } = useI18n();
    const { stores, canConsolidate, loading: storesLoading } = useReportStores();
    const [data, setData] = useState<BSData | null>(null);
    const [scope, setScope] = useState<ReportScopeMode>('branch');
    const [storeId, setStoreId] = useState('');
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [includeCompanyBucket, setIncludeCompanyBucket] = useState(false);
    const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
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
        setInitialized(true);
    }, [stores, storesLoading, canConsolidate]);

    const load = useCallback(async () => {
        if (!initialized) {
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const result = await api.getBalanceSheet({
                asOfDate: asOfDate || undefined,
                ...buildScopeParams(scope, storeId, selectedStoreIds, includeCompanyBucket),
            });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? t.accounting.reports.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [asOfDate, scope, storeId, selectedStoreIds, includeCompanyBucket, initialized, t.accounting.reports.loadFailed]);

    useEffect(() => {
        if (initialized) {
            void load();
        }
    }, [initialized, load]);

    const isCompare = data?.scope === 'compare';

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
            <AccountingToolbar>
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
                                    label: 'Current Period Net Profit',
                                    amounts: data.net_profit,
                                    emphasis: 'profit' as const,
                                }] : []),
                                ...(data.total_assets ? [{
                                    label: 'Total Assets',
                                    amounts: data.total_assets,
                                    emphasis: 'default' as const,
                                }] : []),
                                ...(data.totals ? [{
                                    label: 'Total Liabilities + Equity',
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
                            <span className="ml-2">{t.accounting.reports.balanceSheet.asOf} {data.as_of}</span>
                        </div>

                        <div className="grid md:grid-cols-2 gap-3">
                            <CompactSection className="space-y-3">
                                <BSSection groups={data.assets?.groups ?? []} label={t.accounting.reports.assets} colorClass="bg-sky-50 text-sky-700" />
                                <div className="flex justify-between items-center px-3 py-2 bg-sky-50 rounded-lg font-semibold text-sm text-sky-800 border border-sky-100">
                                    <span>Total Assets</span>
                                    <span>{formatBDT(data.assets?.total ?? 0, { locale })}</span>
                                </div>
                            </CompactSection>

                            <div className="space-y-3">
                                <CompactSection className="space-y-3">
                                    <BSSection groups={data.liabilities?.groups ?? []} label={t.accounting.reports.liabilities} colorClass="bg-rose-50 text-rose-700" />
                                    <div className="flex justify-between items-center px-3 py-2 bg-rose-50 rounded-lg font-semibold text-sm text-rose-800 border border-rose-100">
                                        <span>Total Liabilities</span>
                                        <span>{formatBDT(data.liabilities?.total ?? 0, { locale })}</span>
                                    </div>
                                </CompactSection>

                                <CompactSection className="space-y-3">
                                    <BSSection groups={data.equity?.groups ?? []} label={t.accounting.reports.equity} colorClass="bg-violet-50 text-violet-700" />
                                    <div className="flex justify-between items-center px-5 py-1 text-sm text-gray-600">
                                        <span>Current Period Net Profit</span>
                                        <span className={(data.equity?.net_profit ?? 0) >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                                            {formatBDT(data.equity?.net_profit ?? 0, { locale })}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center px-3 py-2 bg-violet-50 rounded-lg font-semibold text-sm text-violet-800 border border-violet-100">
                                        <span>Total Equity</span>
                                        <span>{formatBDT(data.equity?.total ?? 0, { locale })}</span>
                                    </div>
                                </CompactSection>

                                <div className="flex justify-between items-center px-4 py-3 bg-gray-900 text-white rounded-lg font-semibold text-sm">
                                    <span>Total Liabilities + Equity</span>
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