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

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

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

interface PLData {
    scope?: string;
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

function AccountSection({ groups, label, colorClass, locale }: { groups: Group[]; label: string; colorClass: string; locale: string }) {
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

export default function ProfitLossPage() {
    const { t, locale } = useI18n();
    const { stores, canConsolidate, loading: storesLoading } = useReportStores();
    const [data, setData] = useState<PLData | null>(null);
    const [scope, setScope] = useState<ReportScopeMode>('branch');
    const [storeId, setStoreId] = useState('');
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [includeCompanyBucket, setIncludeCompanyBucket] = useState(false);
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
        setInitialized(true);
    }, [stores, storesLoading, canConsolidate]);

    const load = useCallback(async () => {
        if (!initialized) {
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const result = await api.getProfitLoss({
                from: fromDate || undefined,
                to: toDate || undefined,
                ...buildScopeParams(scope, storeId, selectedStoreIds, includeCompanyBucket),
            });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? t.accounting.reports.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [fromDate, toDate, scope, storeId, selectedStoreIds, includeCompanyBucket, initialized, t.accounting.reports.loadFailed]);

    useEffect(() => {
        if (initialized) {
            void load();
        }
    }, [initialized, load]);

    const isCompare = data?.scope === 'compare';
    const period = data?.period ?? data?.filters;
    const netProfitValue = typeof data?.net_profit === 'number'
        ? data.net_profit
        : (data?.net_profit?.total ?? 0);
    const isProfit = netProfitValue >= 0;

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

                        <AccountSection groups={data.revenue.groups} label={t.accounting.reports.revenue} colorClass="bg-emerald-50 text-emerald-700" locale={locale} />

                        <div className="flex justify-between items-center px-3 py-2 bg-emerald-50 rounded-lg font-semibold text-sm text-emerald-800 border border-emerald-100">
                            <span>{t.accounting.reports.totalRevenue}</span>
                            <span>{formatBDT(data.revenue.total, { locale })}</span>
                        </div>

                        <AccountSection groups={data.expenses.groups} label={t.accounting.reports.expenses} colorClass="bg-rose-50 text-rose-700" locale={locale} />

                        <div className="flex justify-between items-center px-3 py-2 bg-rose-50 rounded-lg font-semibold text-sm text-rose-800 border border-rose-100">
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