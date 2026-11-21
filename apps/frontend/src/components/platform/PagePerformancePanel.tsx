'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CompactStat, Select } from '@/components/ui';
import PhaseBar, { PhaseSwatch, type PhaseSegment } from '@/components/page-timing/PhaseBar';
import { PHASE_ORDER, type PhaseKey } from '@/components/page-timing/phases';
import { api } from '@/lib/api';
import type { NavType } from '@/lib/page-timing/collector';
import {
    PAGE_TIMING_WINDOWS,
    type PageTimingRouteStats,
    type PageTimingSummary,
    type PageTimingWindow,
} from '@/lib/page-timing/dashboard-types';
import { formatMs, SPEED_TEXT, speedTone } from '@/lib/page-timing/format';
import { useI18n } from '@/lib/i18n';

type NavFilter = 'all' | NavType;

const WINDOW_KEY: Record<PageTimingWindow, 'day1' | 'day7' | 'day30'> = { 1: 'day1', 7: 'day7', 30: 'day30' };

const PHASE_FIELD: Record<PhaseKey, keyof PageTimingRouteStats> = {
    document: 'document_ms',
    boot: 'boot_ms',
    data: 'data_ms',
    render: 'render_ms',
};

/**
 * Real users' page load times per page, from the samples every signed-in
 * browser reports: percentiles of the total, medians of each phase, so a row
 * says both how slow a page is and where a typical view of it spends the time.
 */
export default function PagePerformancePanel() {
    const { t } = useI18n();
    const m = t.admin.pageTiming;
    const d = m.dashboard;
    const [days, setDays] = useState<PageTimingWindow>(7);
    const [navFilter, setNavFilter] = useState<NavFilter>('all');
    const [summary, setSummary] = useState<PageTimingSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setFailed(false);
        api.getPageTimingSummary({ days, navType: navFilter === 'all' ? null : navFilter })
            .then((result) => {
                if (!cancelled) setSummary(result);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [days, navFilter]);

    const phaseLabel = (key: PhaseKey) =>
        key === 'boot' ? `${m.phases.boot} / ${m.phases.route}` : m.phases[key];

    const segmentsFor = (row: PageTimingRouteStats): PhaseSegment[] =>
        PHASE_ORDER.flatMap((key) => {
            const value = row[PHASE_FIELD[key]];
            return typeof value === 'number' ? [{ key, label: phaseLabel(key), ms: value }] : [];
        });

    const overall = summary?.overall;

    return (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 md:p-4" aria-labelledby="page-performance-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="page-performance-title" className="text-sm font-semibold text-gray-900">{d.title}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">{d.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        className="w-auto"
                        aria-label={d.windowLabel}
                        value={days}
                        onChange={(event) => setDays(Number(event.target.value) as PageTimingWindow)}
                    >
                        {PAGE_TIMING_WINDOWS.map((window) => (
                            <option key={window} value={window}>{d.windows[WINDOW_KEY[window]]}</option>
                        ))}
                    </Select>
                    <Select
                        className="w-auto"
                        aria-label={d.navTypeLabel}
                        value={navFilter}
                        onChange={(event) => setNavFilter(event.target.value as NavFilter)}
                    >
                        <option value="all">{d.navTypes.all}</option>
                        <option value="load">{d.navTypes.load}</option>
                        <option value="navigate">{d.navTypes.navigate}</option>
                    </Select>
                </div>
            </div>

            {failed ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{d.loadFailed}</p>
            ) : loading && !summary ? (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {d.loading}
                </p>
            ) : summary && overall ? (
                <>
                    <div className="grid grid-cols-3 gap-2">
                        <CompactStat label={d.views} value={overall.views.toLocaleString()} />
                        <CompactStat label={d.p50} value={formatMs(overall.p50_ms)} />
                        <CompactStat label={d.p95} value={formatMs(overall.p95_ms)} />
                    </div>

                    {summary.routes.length === 0 ? (
                        <p className="text-sm text-gray-500">{d.empty}</p>
                    ) : (
                        <>
                            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label={d.phasesMedian}>
                                {PHASE_ORDER.map((key) => (
                                    <li key={key} className="flex items-center gap-1.5">
                                        <PhaseSwatch phase={key} /> {phaseLabel(key)}
                                    </li>
                                ))}
                            </ul>
                            <div className="overflow-x-auto">
                                <table className="w-full text-start text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-100 text-xs font-medium text-gray-500">
                                            <th className="py-2 pe-3 text-start">{d.route}</th>
                                            <th className="py-2 pe-3 text-end">{d.views}</th>
                                            <th className="py-2 pe-3 text-end">{d.p50}</th>
                                            <th className="py-2 pe-3 text-end">{d.p95}</th>
                                            <th className="hidden w-40 py-2 pe-3 text-start md:table-cell">{d.phasesMedian}</th>
                                            <th className="hidden py-2 pe-3 text-end md:table-cell">{d.network}</th>
                                            <th className="hidden py-2 pe-3 text-end md:table-cell">{d.server}</th>
                                            <th className="hidden py-2 pe-3 text-end md:table-cell">{d.db}</th>
                                            <th className="hidden py-2 text-start lg:table-cell">{d.slowestCall}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {summary.routes.map((row) => {
                                            const segments = segmentsFor(row);
                                            return (
                                                <tr key={row.route}>
                                                    <td className="max-w-xs truncate py-2 pe-3 font-mono text-xs text-gray-800" title={row.route}>
                                                        {row.route}
                                                    </td>
                                                    <td className="py-2 pe-3 text-end text-xs tabular-nums text-gray-600">{row.views.toLocaleString()}</td>
                                                    <td className={`py-2 pe-3 text-end text-xs font-semibold tabular-nums ${SPEED_TEXT[speedTone(row.p50_ms)]}`}>
                                                        {formatMs(row.p50_ms)}
                                                    </td>
                                                    <td className={`py-2 pe-3 text-end text-xs font-semibold tabular-nums ${SPEED_TEXT[speedTone(row.p95_ms)]}`}>
                                                        {formatMs(row.p95_ms)}
                                                    </td>
                                                    <td className="hidden py-2 pe-3 md:table-cell">
                                                        <PhaseBar
                                                            size="sm"
                                                            segments={segments}
                                                            label={segments.map((s) => `${s.label} ${formatMs(s.ms)}`).join(', ')}
                                                        />
                                                    </td>
                                                    <td className="hidden py-2 pe-3 text-end text-xs tabular-nums text-gray-600 md:table-cell">{formatMs(row.network_ms)}</td>
                                                    <td className="hidden py-2 pe-3 text-end text-xs tabular-nums text-gray-600 md:table-cell">{formatMs(row.server_ms)}</td>
                                                    <td className="hidden py-2 pe-3 text-end text-xs tabular-nums text-gray-600 md:table-cell">{formatMs(row.db_ms)}</td>
                                                    <td className="hidden max-w-xs truncate py-2 font-mono text-xs text-gray-500 lg:table-cell" title={row.slowest_endpoint ?? undefined}>
                                                        {row.slowest_endpoint ?? '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </>
            ) : null}
        </section>
    );
}
