'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Banknote, History, Receipt, TrendingDown, TrendingUp } from 'lucide-react';
import { AccountingPageShell, CompactSection } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { ListStats, ListToolbar, type ListFilter, type ListStat, type ResolvedListFilter } from '@/components/data-table';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useApprovedOnly } from '@/lib/accounting-report-scope';
import type { CreatedRange } from '@/lib/created-range';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import {
    PERIOD_PRESETS,
    approvedOnlyFilter,
    defaultPeriod,
    requiredPeriod,
    signedPercent,
    wholeTaka,
} from '../_shared/report-chips';

type Figures = { current: number; previous: number; year_ago: number };

interface ComparativeGroup extends Figures {
    group: { id: string; name: string };
    accounts: Array<Figures & {
        id: string; name: string; code?: string | null;
        variance_period: number; variance_period_pct: number | null;
    }>;
}

interface ComparativeData {
    periods: {
        current: { from: string; to: string };
        previous: { from: string; to: string };
        year_ago: { from: string; to: string };
    };
    revenue: { groups: ComparativeGroup[]; total: Figures };
    expenses: { groups: ComparativeGroup[]; total: Figures };
    net_profit: Figures;
}

type Section = 'revenue' | 'expenses';
const SECTIONS: Section[] = ['revenue', 'expenses'];

function VarianceBadge({ pct }: { pct: number | null }) {
    if (pct === null) return <span className="text-gray-400">—</span>;
    return (
        <span className={`text-xs font-semibold ${pct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {signedPercent(pct)}
        </span>
    );
}

/** The change on the previous period, as a percentage of it. */
function changeOnPrevious(figures: Figures): number | null {
    return figures.previous !== 0 ? ((figures.current - figures.previous) / Math.abs(figures.previous)) * 100 : null;
}

/** Keeps the accounts the search finds; a group that itself matches keeps all of its accounts. */
function searchGroups(groups: ComparativeGroup[], query: string): ComparativeGroup[] {
    if (!query.trim()) return groups;
    return groups
        .map((group) => (matchesSearch(query, group.group.name)
            ? group
            : { ...group, accounts: group.accounts.filter((account) => matchesSearch(query, account.name, account.code)) }))
        .filter((group) => group.accounts.length > 0);
}

const thClass = `text-end px-3 py-2 ${compactDensity.formLabel}`;
const thLeftClass = `text-start px-3 py-2 ${compactDensity.formLabel}`;

export default function ComparativePLPage() {
    const { t, locale } = useI18n();
    const ui = t.accountingReportsUi.comparative;
    const reports = t.accounting.reports;
    const [data, setData] = useState<ComparativeData | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const [loading, setLoading] = useState(true);
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sections, setSections] = useState<string[]>([]);

    // approvalReady holds the first fetch until the tenant's approved-only
    // setting is known, so the report is never generated against the wrong value.
    useEffect(() => {
        if (!approvalReady) return;
        let active = true;
        setLoading(true);
        setError(null);
        api.getComparativePL({ approvedOnly, from: period.from || undefined, to: period.to || undefined })
            .then((result: ComparativeData) => {
                if (active) setData(result);
            })
            .catch((err: unknown) => {
                if (active) setError(err instanceof Error ? err.message : reports.loadFailed);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [period, approvalReady, approvedOnly, reports.loadFailed]);

    const sectionLabels: Record<Section, string> = useMemo(
        () => ({ revenue: reports.revenue, expenses: reports.expenses }),
        [reports],
    );

    const filters = useMemo<ResolvedListFilter[]>(() => {
        const list: ListFilter[] = [
            {
                id: 'period',
                type: 'date-range',
                label: t.accountingShared.period,
                value: period,
                // The comparison is always of some period: cleared, it goes back to this month.
                required: true,
                defaultValue: defaultPeriod(),
                onChange: (next) => setPeriod(requiredPeriod(next)),
                presets: PERIOD_PRESETS,
                operators: true,
            },
            {
                id: 'section',
                type: 'multi-select',
                label: ui.section,
                value: sections,
                onChange: setSections,
                options: SECTIONS.map((section) => ({ value: section, label: sectionLabels[section] })),
            },
            ...approvedOnlyFilter(t, { approvalEnabled, approvedOnly, onChange: setApprovedOnly }).map((filter) => ({ ...filter, more: true })),
        ];
        return list as ResolvedListFilter[];
    }, [t, ui, period, sections, sectionLabels, approvalEnabled, approvedOnly, setApprovedOnly]);

    // The statement's own totals for each period — the search finds rows, it
    // does not re-add the statement.
    const stats = useMemo(() => {
        const change = (figures: Figures | undefined) => {
            const pct = figures ? signedPercent(changeOnPrevious(figures)) : null;
            return pct ? formatMessage(ui.changeHint, { value: pct }) : undefined;
        };
        const net = data?.net_profit;
        const tone = (value: number | undefined): ListStat['tone'] => ((value ?? 0) < 0 ? 'danger' : 'default');
        const items: ListStat[] = [
            {
                id: 'revenue',
                icon: <Banknote aria-hidden />,
                label: reports.totalRevenue,
                value: wholeTaka(data?.revenue.total.current ?? 0, locale),
                hint: change(data?.revenue.total),
            },
            {
                id: 'expenses',
                icon: <Receipt aria-hidden />,
                label: reports.totalExpenses,
                value: wholeTaka(data?.expenses.total.current ?? 0, locale),
                hint: change(data?.expenses.total),
            },
            {
                id: 'net',
                icon: (net?.current ?? 0) >= 0 ? <TrendingUp aria-hidden /> : <TrendingDown aria-hidden />,
                label: reports.netProfit,
                value: wholeTaka(net?.current ?? 0, locale),
                hint: change(net),
                tone: tone(net?.current),
            },
            {
                id: 'netPrevious',
                icon: <History aria-hidden />,
                label: ui.netPrevious,
                value: wholeTaka(net?.previous ?? 0, locale),
                tone: tone(net?.previous),
            },
            {
                id: 'netYearAgo',
                icon: <History aria-hidden />,
                label: ui.netYearAgo,
                value: wholeTaka(net?.year_ago ?? 0, locale),
                tone: tone(net?.year_ago),
            },
        ];
        return items;
    }, [data, locale, reports, ui]);

    const showSection = (section: Section) => matchesAnyOf(sections, section);

    const renderSection = (section: Section, block: { groups: ComparativeGroup[]; total: Figures }) => {
        const isRevenue = section === 'revenue';
        const headClass = isRevenue ? 'bg-emerald-50 text-emerald-700' : 'bg-danger-light text-danger-text';
        return (
            <>
                <tr className={headClass}>
                    <td colSpan={5} className="px-3 py-1.5 text-xs font-medium">{sectionLabels[section]}</td>
                </tr>
                {searchGroups(block.groups, search).map((g) => (
                    <Fragment key={g.group.id}>
                        <tr className="bg-gray-50/50 border-b border-gray-100">
                            <td className="px-3 py-1.5 font-semibold text-gray-700 text-xs">{g.group.name}</td>
                            <td className="px-3 py-1.5 text-end font-semibold tabular-nums">{formatBDT(g.current, { locale })}</td>
                            <td className="px-3 py-1.5 text-end text-gray-500 tabular-nums">{formatBDT(g.previous, { locale })}</td>
                            <td className="px-3 py-1.5 text-end text-gray-500 tabular-nums">{formatBDT(g.year_ago, { locale })}</td>
                            <td className="px-3 py-1.5 text-end">—</td>
                        </tr>
                        {g.accounts.map((a) => (
                            <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                <td className="ps-5 pe-3 py-1.5 text-gray-600">{a.name}{a.code && <span className="ms-2 text-xs text-gray-400">{a.code}</span>}</td>
                                <td className="px-3 py-1.5 text-end tabular-nums">{formatBDT(a.current, { locale })}</td>
                                <td className="px-3 py-1.5 text-end text-gray-500 tabular-nums">{formatBDT(a.previous, { locale })}</td>
                                <td className="px-3 py-1.5 text-end text-gray-500 tabular-nums">{formatBDT(a.year_ago, { locale })}</td>
                                <td className="px-3 py-1.5 text-end"><VarianceBadge pct={a.variance_period_pct} /></td>
                            </tr>
                        ))}
                    </Fragment>
                ))}
                <tr className={`${headClass} font-semibold border-y ${isRevenue ? 'border-emerald-100' : 'border-red-100'}`}>
                    <td className="px-3 py-2 text-xs">{isRevenue ? reports.totalRevenue : reports.totalExpenses}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{formatBDT(block.total.current, { locale })}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{formatBDT(block.total.previous, { locale })}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{formatBDT(block.total.year_ago, { locale })}</td>
                    <td className="px-3 py-2 text-end"><VarianceBadge pct={changeOnPrevious(block.total)} /></td>
                </tr>
            </>
        );
    };

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={reports.comparativePl.title}
                subtitle={reports.comparativePl.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    reports.comparativePl.title,
                    'accounting',
                )}
            />

            <ListStats stats={stats} loading={loading || !data} label={t.accountingReportsUi.common.stats} />

            <ListToolbar
                tableId="accounting-comparative-pl"
                filterLayout="row"
                viewOptions={false}
                filters={filters}
                search={{ value: search, onChange: setSearch, placeholder: t.accountingReportsUi.common.searchAccounts }}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">{t.accountingShared.loading}</CompactSection>
            ) : data ? (
                <CompactSection className="p-0 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                                <th className={thLeftClass}>{t.accountingShared.account}</th>
                                <th className={thClass}>
                                    {ui.current}<div className="text-[10px] font-normal text-gray-400">{data.periods.current.from} — {data.periods.current.to}</div>
                                </th>
                                <th className={thClass}>
                                    {ui.previous}<div className="text-[10px] font-normal text-gray-400">{data.periods.previous.from} — {data.periods.previous.to}</div>
                                </th>
                                <th className={thClass}>
                                    {ui.yearAgo}<div className="text-[10px] font-normal text-gray-400">{data.periods.year_ago.from} — {data.periods.year_ago.to}</div>
                                </th>
                                <th className={thClass}>{ui.vsPrevious}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {showSection('revenue') ? renderSection('revenue', data.revenue) : null}
                            {showSection('expenses') ? renderSection('expenses', data.expenses) : null}
                            <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
                                <td className="px-3 py-3 text-blue-800">{reports.netProfit}</td>
                                <td className={`px-3 py-3 text-end tabular-nums ${data.net_profit.current < 0 ? 'text-red-600' : 'text-blue-900'}`}>{formatBDT(data.net_profit.current, { locale })}</td>
                                <td className="px-3 py-3 text-end tabular-nums text-blue-700">{formatBDT(data.net_profit.previous, { locale })}</td>
                                <td className="px-3 py-3 text-end tabular-nums text-blue-700">{formatBDT(data.net_profit.year_ago, { locale })}</td>
                                <td className="px-3 py-3 text-end"><VarianceBadge pct={changeOnPrevious(data.net_profit)} /></td>
                            </tr>
                        </tbody>
                    </table>
                </CompactSection>
            ) : null}
        </AccountingPageShell>
    );
}
