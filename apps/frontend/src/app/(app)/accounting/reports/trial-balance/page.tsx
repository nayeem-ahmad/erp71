'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import ReportScopeBar from '@/components/accounting/ReportScopeBar';
import CompareMatrixTable, { type CompareTrialBalanceRow } from '@/components/accounting/CompareMatrixTable';
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

function defaultToday() {
    return new Date().toISOString().slice(0, 10);
}

interface TBRow {
    account: { id: string; name: string; code?: string | null; type: string; group: { name: string }; subgroup?: { name: string } | null };
    debit_total: number;
    credit_total: number;
    closing_balance: number;
    closing_balance_side: string;
    debit_balance: number;
    credit_balance: number;
}

interface TBData {
    scope?: string;
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

const thClass = `text-right px-3 py-2 ${compactDensity.formLabel}`;
const thLeftClass = `text-left px-3 py-2 ${compactDensity.formLabel}`;

export default function TrialBalancePage() {
    const { t, locale } = useI18n();
    const { stores, canConsolidate, loading: storesLoading } = useReportStores();
    const [data, setData] = useState<TBData | null>(null);
    const [scope, setScope] = useState<ReportScopeMode>('branch');
    const [storeId, setStoreId] = useState('');
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [includeCompanyBucket, setIncludeCompanyBucket] = useState(false);
    const [asOfDate, setAsOfDate] = useState(defaultToday());
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
            const result = await api.getTrialBalance({
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
                                    <th className={thLeftClass}>{t.accountingShared.account}</th>
                                    <th className={thLeftClass}>{t.accountingShared.type}</th>
                                    <th className={thClass}>Gross Debit</th>
                                    <th className={thClass}>Gross Credit</th>
                                    <th className={thClass}>Debit Balance</th>
                                    <th className={thClass}>Credit Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data.rows as TBRow[]).map((row) => (
                                    <tr key={row.account.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                        <td className="px-3 py-2">
                                            <span className="font-medium text-gray-800">{row.account.name}</span>
                                            {row.account.code && <span className="ml-2 text-xs text-gray-400">{row.account.code}</span>}
                                            <div className="text-xs text-gray-400">{row.account.group.name}</div>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-500">{row.account.type}</td>
                                        <td className="px-3 py-2 text-right text-gray-700">{formatBDT(row.debit_total, { locale })}</td>
                                        <td className="px-3 py-2 text-right text-gray-700">{formatBDT(row.credit_total, { locale })}</td>
                                        <td className="px-3 py-2 text-right font-medium text-gray-800">{row.debit_balance > 0 ? formatBDT(row.debit_balance, { locale }) : '—'}</td>
                                        <td className="px-3 py-2 text-right font-medium text-gray-800">{row.credit_balance > 0 ? formatBDT(row.credit_balance, { locale }) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                                    <td className="px-3 py-2 text-xs" colSpan={4}>{t.accountingShared.totals}</td>
                                    <td className="px-3 py-2 text-right text-gray-900">{formatBDT(data.totals.debit as number, { locale })}</td>
                                    <td className="px-3 py-2 text-right text-gray-900">{formatBDT(data.totals.credit as number, { locale })}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </CompactSection>
                )
            ) : null}
        </AccountingPageShell>
    );
}