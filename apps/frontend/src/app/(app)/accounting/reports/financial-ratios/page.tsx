'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Hourglass, Percent, Scale, TrendingUp } from 'lucide-react';
import { AccountingPageShell, CompactSection } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { ListStats, ListToolbar, type ListFilter, type ListStat, type ResolvedListFilter } from '@/components/data-table';
import { StatusBadge } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useApprovedOnly } from '@/lib/accounting-report-scope';
import type { CreatedRange } from '@/lib/created-range';
import {
    AS_OF_PRESETS,
    PERIOD_PRESETS,
    approvedOnlyFilter,
    asOfFromRange,
    asOfRange,
    defaultPeriod,
    requiredPeriod,
    todayDate,
} from '../_shared/report-chips';

interface RatiosData {
    as_of: string;
    period: { from: string; to: string };
    ratios: {
        current_ratio: number | null;
        gross_margin_pct: number | null;
        net_profit_margin_pct: number | null;
        dso_days: number | null;
        dpo_days: number | null;
        revenue: number;
        total_expenses: number;
        net_profit: number;
        total_assets: number;
        total_liabilities: number;
    };
}

type RatioKey = 'current_ratio' | 'gross_margin_pct' | 'net_profit_margin_pct' | 'dso_days' | 'dpo_days';

interface RatioSpec {
    key: RatioKey;
    label: string;
    description: string;
    format: 'number' | 'pct' | 'days';
    healthy: (value: number) => boolean;
    /** A margin below zero is a loss, not merely a ratio to watch. */
    lossWhenNegative?: boolean;
    icon: React.ReactNode;
}

export default function FinancialRatiosPage() {
    const { t, locale } = useI18n();
    const fr = t.accounting.reports.financialRatios;
    const ui = t.accountingReportsUi.ratios;
    const [data, setData] = useState<RatiosData | null>(null);
    const [asOfDate, setAsOfDate] = useState(todayDate);
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const [loading, setLoading] = useState(true);
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [error, setError] = useState<string | null>(null);

    // approvalReady holds the first fetch until the tenant's approved-only
    // setting is known, so the report is never generated against the wrong value.
    useEffect(() => {
        if (!approvalReady) return;
        let active = true;
        setLoading(true);
        setError(null);
        api.getFinancialRatios({
            approvedOnly,
            asOfDate: asOfDate || undefined,
            from: period.from || undefined,
            to: period.to || undefined,
        })
            .then((result: RatiosData) => {
                if (active) setData(result);
            })
            .catch((err: unknown) => {
                if (active) setError(err instanceof Error ? err.message : t.accounting.reports.loadFailed);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [asOfDate, period, approvalReady, approvedOnly, t.accounting.reports.loadFailed]);

    const specs = useMemo<RatioSpec[]>(() => [
        { key: 'current_ratio', label: fr.currentRatio, description: fr.currentRatioDesc, format: 'number', healthy: (v) => v >= 1, icon: <Scale aria-hidden /> },
        { key: 'gross_margin_pct', label: fr.grossMargin, description: fr.grossMarginDesc, format: 'pct', healthy: (v) => v >= 0, lossWhenNegative: true, icon: <Percent aria-hidden /> },
        { key: 'net_profit_margin_pct', label: fr.netProfitMargin, description: fr.netProfitMarginDesc, format: 'pct', healthy: (v) => v >= 0, lossWhenNegative: true, icon: <TrendingUp aria-hidden /> },
        { key: 'dso_days', label: fr.dso, description: fr.dsoDesc, format: 'days', healthy: (v) => v <= 45, icon: <CalendarClock aria-hidden /> },
        { key: 'dpo_days', label: fr.dpo, description: fr.dpoDesc, format: 'days', healthy: (v) => v <= 60, icon: <Hourglass aria-hidden /> },
    ], [fr]);

    const formatRatio = (value: number | null, format: RatioSpec['format']) => {
        if (value === null) return ui.notAvailable;
        if (format === 'pct') return `${value.toFixed(1)}%`;
        if (format === 'days') return formatMessage(ui.days, { value: value.toFixed(1) });
        return value.toFixed(2);
    };

    const filters = useMemo<ResolvedListFilter[]>(() => {
        const list: ListFilter[] = [
            {
                id: 'asOf',
                type: 'date-range',
                label: ui.asOf,
                value: asOfRange(asOfDate),
                // The balance-sheet ratios are always as of some day: cleared, today.
                onChange: (next) => setAsOfDate(asOfFromRange(next)),
                presets: AS_OF_PRESETS,
                operators: true,
            },
            {
                id: 'period',
                type: 'date-range',
                label: ui.plPeriod,
                value: period,
                // The P&L ratios are always over some period: cleared, this month.
                onChange: (next) => setPeriod(requiredPeriod(next)),
                presets: PERIOD_PRESETS,
                operators: true,
            },
            ...approvedOnlyFilter(t, { approvalEnabled, approvedOnly, onChange: setApprovedOnly }),
        ];
        return list as ResolvedListFilter[];
    }, [t, ui, asOfDate, period, approvalEnabled, approvedOnly, setApprovedOnly]);

    const stats = useMemo(() => specs.map((spec): ListStat => {
        const value = data?.ratios[spec.key] ?? null;
        const unhealthy = value !== null && !spec.healthy(value);
        return {
            id: spec.key,
            icon: spec.icon,
            label: spec.label,
            value: formatRatio(value, spec.format),
            tone: !unhealthy ? 'default' : spec.lossWhenNegative ? 'danger' : 'warning',
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [specs, data, ui]);

    const summary = data ? [
        { id: 'revenue', label: t.accounting.reports.revenue, value: data.ratios.revenue },
        { id: 'expenses', label: fr.totalExpenses, value: data.ratios.total_expenses },
        { id: 'net', label: t.accounting.reports.netProfit, value: data.ratios.net_profit, signed: true },
        { id: 'assets', label: fr.totalAssets, value: data.ratios.total_assets },
        { id: 'liabilities', label: ui.totalLiabilities, value: data.ratios.total_liabilities },
    ] : [];

    return (
        <AccountingPageShell maxWidth="narrow">
            <PageHeader
                title={fr.title}
                subtitle={fr.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    fr.title,
                    'accounting',
                )}
            />

            <ListStats stats={stats} loading={loading || !data} label={t.accountingReportsUi.common.stats} />

            <ListToolbar tableId="accounting-financial-ratios" filters={filters} />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">{t.accountingShared.loading}</CompactSection>
            ) : data ? (
                <div className="space-y-3">
                    <CompactSection className="p-0 overflow-hidden">
                        <ul className="divide-y divide-gray-100">
                            {specs.map((spec) => {
                                const value = data.ratios[spec.key];
                                const healthy = value === null ? null : spec.healthy(value);
                                return (
                                    <li key={spec.key} className="flex items-center justify-between gap-3 px-3 py-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-gray-800">{spec.label}</p>
                                            <p className="text-xs text-gray-500">{spec.description}</p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <span className="text-sm font-semibold tabular-nums text-gray-900">{formatRatio(value, spec.format)}</span>
                                            {healthy === null ? null : (
                                                <StatusBadge tone={healthy ? 'success' : spec.lossWhenNegative ? 'danger' : 'warning'}>
                                                    {healthy ? ui.healthy : ui.attention}
                                                </StatusBadge>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </CompactSection>
                    <CompactSection title={ui.summary}>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                            {summary.map((item) => (
                                <div key={item.id}>
                                    <p className={compactDensity.formLabel}>{item.label}</p>
                                    <p className={`font-semibold tabular-nums ${item.signed ? (item.value >= 0 ? 'text-emerald-700' : 'text-red-600') : ''}`}>
                                        {formatBDT(item.value, { locale })}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </CompactSection>
                </div>
            ) : null}
        </AccountingPageShell>
    );
}
