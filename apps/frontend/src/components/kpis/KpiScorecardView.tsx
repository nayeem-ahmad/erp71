'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import {
    KPI_DEFINITION_BY_ID,
    kpiChange,
    type KpiAudience,
    type KpiDefinition,
    type KpiResult,
    type KpiScorecard,
} from '@erp71/shared-types';
import { Alert, Button, CompactSection, PageShell, Select } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { SkeletonBar } from '@/components/ui/PageSkeleton';
import type { BreadcrumbItem } from '@/lib/page-breadcrumbs';
import { addCalendarDays, tenantDateOnly } from '@/lib/created-range';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export const KPI_PERIODS = ['thisMonth', 'lastMonth', 'last3Months', 'last12Months', 'thisYear'] as const;
export type KpiPeriod = (typeof KPI_PERIODS)[number];

/** The calendar days a period preset covers, ending today in the workspace's zone. */
export function kpiPeriodRange(period: KpiPeriod, today: string = tenantDateOnly()): { from: string; to: string } {
    const [year, month] = today.split('-').map(Number);
    const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    switch (period) {
        case 'lastMonth': {
            const thisMonthStart = monthStart(year, month);
            return { from: monthStart(year, month - 1), to: addCalendarDays(thisMonthStart, -1) };
        }
        case 'last3Months':
            return { from: monthStart(year, month - 2), to: today };
        case 'last12Months':
            return { from: monthStart(year, month - 11), to: today };
        case 'thisYear':
            return { from: `${year}-01-01`, to: today };
        case 'thisMonth':
        default:
            return { from: monthStart(year, month), to: today };
    }
}

/** Inputs shown in BDT; every other input is a plain count or percentage. */
const MONEY_INPUTS = new Set([
    'revenue', 'previousRevenue', 'grossProfit', 'costedRevenue', 'netProfit', 'investing', 'financing',
    'netChange', 'cashOnHand', 'monthlyBurn', 'monthlyGrossProfitPerCustomer', 'retainedRevenue',
    'startingRevenue', 'namedRevenue', 'averageBasket', 'creditSales',
]);

type Copy = ReturnType<typeof useI18n>['t']['kpis'];

function useKpiFormat() {
    const { t, locale, fmt } = useI18n();
    const copy = t.kpis;
    const number = useCallback(
        (value: number, digits = 1) => value.toLocaleString(locale, { maximumFractionDigits: digits }),
        [locale],
    );
    const money = useCallback(
        (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 }),
        [locale],
    );

    const value = useCallback((definition: KpiDefinition, result: KpiResult): string => {
        if (result.value === null) {
            if (result.status === 'ok' && result.notes.includes('cash_positive')) return copy.status.cashPositive;
            return '—';
        }
        switch (definition.unit) {
            case 'percent':
                return `${number(result.value)}%`;
            case 'money':
                return money(result.value);
            case 'months':
                return fmt(copy.units.months, { value: number(result.value) });
            case 'days':
                return fmt(copy.units.days, { value: number(result.value) });
            case 'ratio':
                return fmt(copy.units.ratio, { value: number(result.value) });
            default:
                return number(result.value, 0);
        }
    }, [copy, fmt, money, number]);

    const input = useCallback((key: string, raw: number | null) => {
        if (raw === null) return '—';
        return MONEY_INPUTS.has(key) ? money(raw) : number(raw);
    }, [money, number]);

    return { copy, fmt, number, value, input };
}

function ChangeChip({ definition, result }: { definition: KpiDefinition; result: KpiResult }) {
    const { copy, fmt, number } = useKpiFormat();
    const change = kpiChange(definition, result.value, result.previous);
    if (!change) return null;

    const tone = change.improved === null
        ? 'bg-gray-100 text-gray-600'
        : change.improved
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-red-50 text-red-700';
    const Icon = change.amount > 0 ? ArrowUpRight : change.amount < 0 ? ArrowDownRight : Minus;
    const sign = change.amount > 0 ? '+' : '';
    const text = change.kind === 'points'
        ? fmt(copy.points, { value: `${sign}${number(change.amount)}` })
        : `${sign}${number(change.amount)}%`;

    return (
        <span
            className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${tone}`}
            title={copy.vsPrevious}
        >
            <Icon className="h-3 w-3" aria-hidden />
            {text}
            <span className="sr-only"> {copy.vsPrevious}</span>
        </span>
    );
}

export function KpiTile({ result }: { result: KpiResult }) {
    const { copy, fmt, value, input } = useKpiFormat();
    const definition = KPI_DEFINITION_BY_ID[result.id];
    const words = copy.items[result.id];
    const planned = result.status === 'planned';
    const inputs = Object.entries(result.basis);

    return (
        <article
            className={`flex flex-col rounded-lg border p-3 ${planned ? 'border-dashed border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'}`}
            aria-labelledby={`kpi-${result.id}`}
            data-testid={`kpi-${result.id}`}
        >
            <div className="flex items-start justify-between gap-2">
                <h3 id={`kpi-${result.id}`} className="text-xs font-medium text-gray-600">
                    <span className="tabular-nums text-gray-400">{definition.number}.</span> {words.label}
                </h3>
                {planned ? null : <ChangeChip definition={definition} result={result} />}
            </div>

            {planned ? (
                <>
                    <p className="mt-1 text-sm font-medium text-gray-500">
                        {fmt(copy.status.planned, { phase: result.phase ?? '' })}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{words.what}</p>
                    {result.needs ? <p className="mt-1 text-xs text-gray-500">{copy.needs[result.needs]}</p> : null}
                </>
            ) : (
                <>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{value(definition, result)}</p>
                    {result.status === 'no_data' && !result.notes.includes('books_unavailable')
                        ? <p className="text-xs text-gray-500">{copy.status.noData}</p>
                        : null}
                    <p className="mt-1 text-xs text-gray-500">{words.what}</p>
                    {result.notes.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                            {result.notes.map((note) => (
                                <li key={note} className={note === 'partly_costed' || note === 'books_unavailable' ? 'text-amber-700' : undefined}>
                                    {copy.notes[note]}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </>
            )}

            <details className="group mt-auto pt-2 text-xs">
                <summary className="flex min-h-touch cursor-pointer items-center text-blue-600 hover:underline md:min-h-0">
                    <span className="group-open:hidden">{copy.showHow}</span>
                    <span className="hidden group-open:inline">{copy.hideHow}</span>
                </summary>
                <dl className="mt-1 space-y-1 text-gray-600">
                    <div><dt className="inline font-medium">{copy.labels.why}: </dt><dd className="inline">{words.why}</dd></div>
                    <div><dt className="inline font-medium">{copy.labels.how}: </dt><dd className="inline">{words.how}</dd></div>
                    {inputs.length > 0 ? (
                        <div>
                            <dt className="font-medium">{copy.labels.inputs}</dt>
                            <dd>
                                <ul className="mt-0.5 space-y-0.5">
                                    {inputs.map(([key, raw]) => (
                                        <li key={key} className="flex justify-between gap-2">
                                            <span>{copy.basis[key as keyof Copy['basis']] ?? key}</span>
                                            <span className="tabular-nums text-gray-900">{input(key, raw)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </dd>
                        </div>
                    ) : null}
                </dl>
            </details>
        </article>
    );
}

function TileGrid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

/**
 * The scorecard page body shared by a shop (`/scorecard`) and the platform
 * (`/admin/kpis`): a period picker, the measured KPIs, then the ones that are
 * planned. Each page supplies its own loader, title and header actions.
 */
export default function KpiScorecardView({
    audience,
    title,
    subtitle,
    breadcrumbs,
    actions,
    load,
    ready = true,
}: {
    audience: KpiAudience;
    title: string;
    subtitle: string;
    breadcrumbs: BreadcrumbItem[];
    /** Extra header controls before the period picker, e.g. the branch filter. */
    actions?: ReactNode;
    load: (range: { from: string; to: string }) => Promise<KpiScorecard>;
    /** False while the page is still working out what to ask for (branch scope). */
    ready?: boolean;
}) {
    const { copy, fmt } = useKpiFormat();
    const [period, setPeriod] = useState<KpiPeriod>('thisMonth');
    const [card, setCard] = useState<KpiScorecard | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const range = useMemo(() => kpiPeriodRange(period), [period]);

    const fetchCard = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            setCard(await load(range));
        } catch {
            setCard(null);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [load, range]);

    useEffect(() => {
        if (ready) void fetchCard();
    }, [ready, fetchCard]);

    const visible = (card?.kpis ?? []).filter((k) => k.status !== 'not_applicable');
    const measured = visible.filter((k) => k.status !== 'planned');
    const planned = visible.filter((k) => k.status === 'planned');

    return (
        <PageShell>
            <div className="space-y-4" data-audience={audience}>
                <PageHeader
                    title={title}
                    subtitle={subtitle}
                    breadcrumbs={breadcrumbs}
                    actions={(
                        <div className="flex flex-wrap items-center gap-2">
                            {actions}
                            <Select
                                value={period}
                                onChange={(event) => setPeriod(event.target.value as KpiPeriod)}
                                aria-label={copy.periods.label}
                                className="w-auto"
                                data-testid="kpi-period"
                            >
                                {KPI_PERIODS.map((key) => (
                                    <option key={key} value={key}>{copy.periods[key]}</option>
                                ))}
                            </Select>
                        </div>
                    )}
                />

                {card ? (
                    <p className="text-xs text-gray-500">
                        {fmt(copy.comparedWith, { from: card.previousPeriod.from, to: card.previousPeriod.to })}
                    </p>
                ) : null}

                {card && card.unpostedVouchers > 0 ? (
                    <Alert tone="warning">{fmt(copy.unpostedVouchers, { count: card.unpostedVouchers })}</Alert>
                ) : null}

                {failed ? (
                    <Alert tone="danger">
                        <span className="me-2">{copy.loadFailed}</span>
                        <Button variant="secondary" onClick={() => void fetchCard()}>{copy.retry}</Button>
                    </Alert>
                ) : null}

                {loading && !card ? (
                    <TileGrid>
                        {Array.from({ length: 8 }, (_, i) => (
                            <div key={i} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                                <SkeletonBar className="h-3 w-1/2" />
                                <SkeletonBar className="h-6 w-2/3" />
                                <SkeletonBar className="h-3 w-full" />
                            </div>
                        ))}
                    </TileGrid>
                ) : null}

                {measured.length > 0 ? (
                    <section aria-label={copy.sections.live} className={loading ? 'opacity-60 transition-opacity' : undefined}>
                        <TileGrid>
                            {measured.map((result) => <KpiTile key={result.id} result={result} />)}
                        </TileGrid>
                    </section>
                ) : null}

                {planned.length > 0 ? (
                    <CompactSection title={copy.sections.planned} titleStyle="heading">
                        <p className="mb-3 text-xs text-gray-500">{copy.sections.plannedHint}</p>
                        <TileGrid>
                            {planned.map((result) => <KpiTile key={result.id} result={result} />)}
                        </TileGrid>
                    </CompactSection>
                ) : null}
            </div>
        </PageShell>
    );
}
