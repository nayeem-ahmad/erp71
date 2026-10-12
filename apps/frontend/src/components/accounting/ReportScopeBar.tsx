'use client';

import { compactDensity } from '@/lib/ui/compact-density';
import { useI18n } from '@/lib/i18n';
import type { ReportLevelMode } from '@/lib/accounting-report-scope';
import { ApprovedOnlyToggle } from '@/components/accounting/ApprovedOnlyToggle';
import {
    persistCompare,
    persistHideZero,
    persistReportLevel,
    REPORT_LEVEL_MODES,
} from '@/lib/accounting-report-scope';

export type ReportStore = { id: string; name: string };

/**
 * The accounting statements' (P&L, balance sheet, trial balance) controls below
 * the header. Which branch — or the whole company — is the page's
 * `BranchFilter`; this bar only adds "Compare branches", which, when ticked,
 * overrides the filter with a side-by-side of the branches picked here.
 */
export type ReportScopeBarProps = {
    /** Side-by-side branches instead of the filter's one branch (or company). */
    compare: boolean;
    onCompareChange: (compare: boolean) => void;
    selectedStoreIds: string[];
    onSelectedStoreIdsChange: (storeIds: string[]) => void;
    includeCompanyBucket: boolean;
    onIncludeCompanyBucketChange: (value: boolean) => void;
    /** The branches offered for comparison. */
    stores: ReportStore[];
    /** Only consolidated viewers may compare. */
    canConsolidate: boolean;
    dateMode: 'range' | 'asOf';
    from: string;
    to: string;
    asOfDate: string;
    onDateChange: (field: 'from' | 'to' | 'asOfDate', value: string) => void;
    onGenerate: () => void;
    generating?: boolean;
    /** Omit both to hide the detail-level control on reports that are not COA-grained. */
    level?: ReportLevelMode;
    onLevelChange?: (level: ReportLevelMode) => void;
    /** Omit both on reports with no balance column to suppress. */
    hideZero?: boolean;
    onHideZeroChange?: (hideZero: boolean) => void;
    /**
     * Per-request override of the tenant's approved-only setting. The toggle
     * hides itself unless the tenant actually requires voucher approval.
     */
    approvedOnly?: boolean;
    onApprovedOnlyChange?: (approvedOnly: boolean) => void;
    approvalEnabled?: boolean;
};

export function ReportScopeBar({
    compare,
    onCompareChange,
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
    level,
    onLevelChange,
    hideZero,
    onHideZeroChange,
    approvedOnly,
    onApprovedOnlyChange,
    approvalEnabled = false,
}: ReportScopeBarProps) {
    const { t } = useI18n();
    const scopeLabels = t.accounting.reports.reportScope;
    const levelLabels = t.accounting.reports.reportLevel;

    const handleCompareChange = (next: boolean) => {
        persistCompare(next);
        onCompareChange(next);
    };

    const handleLevelChange = (nextLevel: ReportLevelMode) => {
        persistReportLevel(nextLevel);
        onLevelChange?.(nextLevel);
    };

    const handleHideZeroChange = (nextHideZero: boolean) => {
        persistHideZero(nextHideZero);
        onHideZeroChange?.(nextHideZero);
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
                {canConsolidate ? (
                    <label className="inline-flex min-h-touch items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={compare}
                            onChange={(event) => handleCompareChange(event.target.checked)}
                            className="text-blue-600"
                        />
                        {scopeLabels.compareBranches}
                    </label>
                ) : null}

                {level && onLevelChange ? (
                    <div className="flex flex-wrap items-center gap-3 md:ms-auto">
                        <span className={compactDensity.formLabel}>{levelLabels.detail}</span>
                        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={levelLabels.detail}>
                            {REPORT_LEVEL_MODES.map((mode) => (
                                <label
                                    key={mode}
                                    className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer"
                                >
                                    <input
                                        type="radio"
                                        name="report-level"
                                        checked={level === mode}
                                        onChange={() => handleLevelChange(mode)}
                                        className="text-blue-600"
                                    />
                                    {levelLabels[mode]}
                                </label>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-4">
                {onHideZeroChange ? (
                    <label className="inline-flex w-fit items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={hideZero ?? false}
                            onChange={(event) => handleHideZeroChange(event.target.checked)}
                            className="text-blue-600"
                        />
                        {t.accountingShared.hideZeroBalances}
                    </label>
                ) : null}

                {onApprovedOnlyChange ? (
                    <ApprovedOnlyToggle
                        checked={approvedOnly ?? false}
                        onChange={onApprovedOnlyChange}
                        enabled={approvalEnabled}
                    />
                ) : null}
            </div>

            {compare && canConsolidate ? (
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
                    disabled={generating || (compare && selectedStoreIds.length === 0)}
                    className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-60`}
                >
                    {generating ? t.accountingShared.loading : scopeLabels.generate}
                </button>
            </div>
        </div>
    );
}

export default ReportScopeBar;