'use client';

import { compactDensity } from '@/lib/ui/compact-density';
import { useI18n } from '@/lib/i18n';
import type { ReportScopeMode } from '@/lib/accounting-report-scope';
import { persistReportScope } from '@/lib/accounting-report-scope';

export type ReportStore = { id: string; name: string };

export type ReportScopeBarProps = {
    scope: ReportScopeMode;
    onScopeChange: (scope: ReportScopeMode) => void;
    storeId: string;
    onStoreIdChange: (storeId: string) => void;
    selectedStoreIds: string[];
    onSelectedStoreIdsChange: (storeIds: string[]) => void;
    includeCompanyBucket: boolean;
    onIncludeCompanyBucketChange: (value: boolean) => void;
    stores: ReportStore[];
    canConsolidate: boolean;
    dateMode: 'range' | 'asOf';
    from: string;
    to: string;
    asOfDate: string;
    onDateChange: (field: 'from' | 'to' | 'asOfDate', value: string) => void;
    onGenerate: () => void;
    generating?: boolean;
};

export function ReportScopeBar({
    scope,
    onScopeChange,
    storeId,
    onStoreIdChange,
    selectedStoreIds,
    onSelectedStoreIdsChange,
    includeCompanyBucket,
    onIncludeCompanyBucketChange,
    stores,
    canConsolidate,
    dateMode,
    from,
    to,
    asOfDate,
    onDateChange,
    onGenerate,
    generating = false,
}: ReportScopeBarProps) {
    const { t } = useI18n();
    const scopeLabels = t.accounting.reports.reportScope;

    const handleScopeChange = (nextScope: ReportScopeMode) => {
        persistReportScope(nextScope);
        onScopeChange(nextScope);
    };

    const toggleStoreSelection = (id: string) => {
        if (selectedStoreIds.includes(id)) {
            if (selectedStoreIds.length <= 1) {
                return;
            }
            onSelectedStoreIdsChange(selectedStoreIds.filter((store) => store !== id));
            return;
        }
        onSelectedStoreIdsChange([...selectedStoreIds, id]);
    };

    return (
        <div className={`${compactDensity.filterBar} flex-col items-stretch gap-3`}>
            <div className="flex flex-wrap items-center gap-3">
                <span className={compactDensity.formLabel}>{scopeLabels.view}</span>
                <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={scopeLabels.view}>
                    <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                        <input
                            type="radio"
                            name="report-scope"
                            checked={scope === 'branch'}
                            onChange={() => handleScopeChange('branch')}
                            className="text-blue-600"
                        />
                        {scopeLabels.thisBranch}
                    </label>
                    {canConsolidate ? (
                        <>
                            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                                <input
                                    type="radio"
                                    name="report-scope"
                                    checked={scope === 'company'}
                                    onChange={() => handleScopeChange('company')}
                                    className="text-blue-600"
                                />
                                {scopeLabels.allBranches}
                            </label>
                            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                                <input
                                    type="radio"
                                    name="report-scope"
                                    checked={scope === 'compare'}
                                    onChange={() => handleScopeChange('compare')}
                                    className="text-blue-600"
                                />
                                {scopeLabels.compareBranches}
                            </label>
                        </>
                    ) : null}
                </div>
            </div>

            {scope === 'branch' ? (
                <div className="flex flex-col gap-1 min-w-[180px]">
                    <span className={compactDensity.formLabel}>{scopeLabels.branch}</span>
                    <select
                        value={storeId}
                        onChange={(event) => onStoreIdChange(event.target.value)}
                        className={compactDensity.formField}
                        aria-label={scopeLabels.branch}
                    >
                        {stores.map((store) => (
                            <option key={store.id} value={store.id}>
                                {store.name}
                            </option>
                        ))}
                    </select>
                </div>
            ) : null}

            {scope === 'compare' ? (
                <div className="space-y-2">
                    <span className={compactDensity.formLabel}>{scopeLabels.selectBranches}</span>
                    <div className="flex flex-wrap gap-2">
                        {stores.map((store) => (
                            <label
                                key={store.id}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-700"
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedStoreIds.includes(store.id)}
                                    onChange={() => toggleStoreSelection(store.id)}
                                />
                                {store.name}
                            </label>
                        ))}
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={includeCompanyBucket}
                            onChange={(event) => onIncludeCompanyBucketChange(event.target.checked)}
                        />
                        {scopeLabels.companyOverhead}
                    </label>
                </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-2">
                {dateMode === 'range' ? (
                    <>
                        <div className="flex flex-col gap-1">
                            <span className={compactDensity.formLabel}>{t.accountingShared.from}</span>
                            <input
                                type="date"
                                value={from}
                                onChange={(event) => onDateChange('from', event.target.value)}
                                className={compactDensity.formField}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className={compactDensity.formLabel}>{t.accountingShared.to}</span>
                            <input
                                type="date"
                                value={to}
                                onChange={(event) => onDateChange('to', event.target.value)}
                                className={compactDensity.formField}
                            />
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>{t.accounting.reports.balanceSheet.asOf}</span>
                        <input
                            type="date"
                            value={asOfDate}
                            onChange={(event) => onDateChange('asOfDate', event.target.value)}
                            className={compactDensity.formField}
                        />
                    </div>
                )}
                <button
                    type="button"
                    onClick={onGenerate}
                    disabled={generating || (scope === 'compare' && selectedStoreIds.length === 0)}
                    className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-60`}
                >
                    {generating ? t.accountingShared.loading : scopeLabels.generate}
                </button>
            </div>
        </div>
    );
}

export default ReportScopeBar;