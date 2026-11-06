import type { DatePreset, ListFilter } from '@/components/data-table';
import type { CompareMatrixSection } from '@/components/accounting/CompareMatrixTable';
import type { StatementGroup } from '@/components/accounting/StatementSection';
import {
    createdRangeFromPreset,
    isCreatedRangeEmpty,
    tenantDateOnly,
    type CreatedRange,
    type CreatedRangePreset,
} from '@/lib/created-range';
import { formatBDT } from '@/lib/format';
import { matchesSearch } from '@/lib/list-filter';
import {
    persistCompare,
    persistHideZero,
    persistReportLevel,
    REPORT_LEVEL_MODES,
    type ReportLevelMode,
} from '@/lib/accounting-report-scope';
import type { useI18n } from '@/lib/i18n';

/*
 * The accounting reports' toolbar chips. A report's parameters (its period,
 * its as-of date, the statements' branch and detail options) sit in the same
 * chip row as a list's filters — but a report is always run for something, so
 * those chips are `required`: no "All" or Clear, no ✕, and Clear all puts them
 * back on their default. Each page's onChange still falls back to its default
 * on a null, belt and braces.
 */

type Copy = ReturnType<typeof useI18n>['t'];

/** Month-grained shortcuts for a report's period. */
export const PERIOD_PRESETS: readonly CreatedRangePreset[] = ['thisMonth', 'last3Months', 'last6Months', 'last12Months', 'thisYear'];

/** An as-of date is one day: the chip offers today and the ends of the periods just closed, or any day picked. */
export const AS_OF_PRESETS: readonly DatePreset[] = ['today', 'endOfLastMonth', 'endOfLastQuarter', 'endOfLastYear'];

/** This month to date, on the workspace's calendar. */
export const defaultPeriod = (): CreatedRange => createdRangeFromPreset('thisMonth');

/** Today, on the workspace's calendar. */
export const todayDate = (): string => tenantDateOnly();

/** A report's period: cleared, it goes back to `fallback`. */
export function requiredPeriod(next: CreatedRange | null, fallback: () => CreatedRange = defaultPeriod): CreatedRange {
    return isCreatedRangeEmpty(next) ? fallback() : (next as CreatedRange);
}

/** A report's as-of date as a one-day chip: cleared, it goes back to `fallback` (today). */
export function asOfFilter(input: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    fallback?: () => string;
}): ListFilter {
    const fallback = input.fallback ?? todayDate;
    return {
        id: 'asOf',
        type: 'date',
        label: input.label,
        value: input.value,
        onChange: (next) => input.onChange(next ?? fallback()),
        presets: AS_OF_PRESETS,
        required: true,
        defaultValue: fallback(),
    };
}

/** Whole taka, as the stats strip shows money. */
export function wholeTaka(value: number, locale: string): string {
    return formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** "+12.5%" / "-3.0%" — or null when there is nothing to divide by. */
export function signedPercent(value: number | null | undefined): string | null {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/** The approved-only override, as a chip — offered only when the tenant approves vouchers at all. */
export function approvedOnlyFilter(t: Copy, input: {
    approvalEnabled: boolean;
    approvedOnly: boolean;
    onChange: (next: boolean) => void;
}): ListFilter[] {
    if (!input.approvalEnabled) return [];
    return [{
        id: 'approvedOnly',
        type: 'toggle',
        label: t.accountingShared.approvedOnly,
        pressed: input.approvedOnly,
        onChange: input.onChange,
    }];
}

/**
 * The statements' (P&L, balance sheet) options: compare branches, which
 * branches, company overhead, detail level, hide zero rows, approved only.
 * Compare, level and hide-zero are remembered across the statements, as the
 * old scope bar remembered them.
 */
export function statementScopeFilters(t: Copy, input: {
    canConsolidate: boolean;
    compare: boolean;
    onCompareChange: (next: boolean) => void;
    stores: Array<{ id: string; name: string }>;
    selectedStoreIds: string[];
    onSelectedStoreIdsChange: (next: string[]) => void;
    includeCompanyBucket: boolean;
    onIncludeCompanyBucketChange: (next: boolean) => void;
    level: ReportLevelMode;
    onLevelChange: (next: ReportLevelMode) => void;
    hideZero: boolean;
    onHideZeroChange: (next: boolean) => void;
    approvalEnabled: boolean;
    approvedOnly: boolean;
    onApprovedOnlyChange: (next: boolean) => void;
}): ListFilter[] {
    const scope = t.accounting.reports.reportScope;
    const levels = t.accounting.reports.reportLevel;
    const filters: ListFilter[] = [
        {
            id: 'level',
            type: 'select',
            label: levels.detail,
            value: input.level,
            // A statement is always at some level; Clear all goes back to account.
            required: true,
            defaultValue: 'account',
            onChange: (next) => {
                const mode = REPORT_LEVEL_MODES.includes(next as ReportLevelMode) ? (next as ReportLevelMode) : 'account';
                persistReportLevel(mode);
                input.onLevelChange(mode);
            },
            options: REPORT_LEVEL_MODES.map((mode) => ({ value: mode, label: levels[mode] })),
        },
    ];

    if (input.canConsolidate) {
        filters.push({
            id: 'compare',
            type: 'toggle',
            label: scope.compareBranches,
            pressed: input.compare,
            onChange: (next) => {
                persistCompare(next);
                input.onCompareChange(next);
            },
        });
        if (input.compare) {
            const allIds = input.stores.map((store) => store.id);
            filters.push(
                {
                    id: 'branches',
                    type: 'multi-select',
                    label: t.accountingReportsUi.common.branches,
                    value: input.selectedStoreIds,
                    // A comparison needs a branch: none picked compares them all.
                    required: true,
                    defaultValue: allIds,
                    onChange: (next) => input.onSelectedStoreIdsChange(next.length ? next : allIds),
                    options: input.stores.map((store) => ({ value: store.id, label: store.name })),
                },
                {
                    id: 'companyBucket',
                    type: 'toggle',
                    label: scope.companyOverhead,
                    pressed: input.includeCompanyBucket,
                    onChange: input.onIncludeCompanyBucketChange,
                    more: true,
                },
            );
        }
    }

    filters.push({
        id: 'hideZero',
        type: 'toggle',
        label: t.accountingShared.hideZeroBalances,
        pressed: input.hideZero,
        onChange: (next) => {
            persistHideZero(next);
            input.onHideZeroChange(next);
        },
    });

    return [
        ...filters,
        // Rarely changed once set: behind More in the one-row toolbar.
        ...approvedOnlyFilter(t, {
            approvalEnabled: input.approvalEnabled,
            approvedOnly: input.approvedOnly,
            onChange: input.onApprovedOnlyChange,
        }).map((filter) => ({ ...filter, more: true })),
    ];
}

/**
 * The search box over a statement: keeps the account rows whose name or code
 * matches, and a whole group when the group itself matches. The group totals
 * are the server's and stay as they are — the search finds rows, it does not
 * re-add the statement.
 */
export function searchStatementGroups(groups: StatementGroup[], query: string): StatementGroup[] {
    if (!query.trim()) return groups;
    return groups
        .map((entry) => {
            if (matchesSearch(query, entry.group.name, entry.group.code)) return entry;
            return {
                ...entry,
                rows: entry.rows.filter((row) => matchesSearch(query, row.name, row.code, row.subgroup?.name)),
            };
        })
        .filter((entry) => entry.rows.length > 0 || matchesSearch(query, entry.group.name, entry.group.code));
}

/** The same search over the branch-comparison matrix. */
export function searchCompareSections(sections: CompareMatrixSection[], query: string): CompareMatrixSection[] {
    if (!query.trim()) return sections;
    return sections.map((section) => ({
        ...section,
        groups: section.groups
            .map((group) => (matchesSearch(query, group.name, group.code)
                ? group
                : { ...group, rows: group.rows.filter((row) => matchesSearch(query, row.account.name, row.account.code)) }))
            .filter((group) => group.rows.length > 0 || matchesSearch(query, group.name, group.code)),
    }));
}

/** A statement figure that is a plain number, or the "total" column of a comparison. */
export function totalFigure(value: number | Record<string, number> | null | undefined): number {
    if (typeof value === 'number') return value;
    return value?.total ?? 0;
}
