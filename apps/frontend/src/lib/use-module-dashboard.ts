'use client';

import { useEffect, useRef, useState } from 'react';
import type { DashboardRange } from '@/components/dashboard/DashboardHeader';
import { periodDelta, type Delta } from './dashboard-delta';
import { previousDateWindow, previousWindow, rangeToDateWindow, rangeToWindow } from './dashboard-range';
import { useI18n } from './i18n';

export type DateWindow = { from: string; to: string };

const NO_COMPARISON: Delta = { label: '—', positive: true };

export type ModuleDashboardState<TOverview, TTrend> = {
    range: DashboardRange;
    setRange: (range: DashboardRange) => void;
    overview: TOverview | null;
    /** The equally long window before this one. Feeds the deltas and nothing else. */
    previous: TOverview | null;
    trends: TTrend[];
    loading: boolean;
    error: string;
    /** "vs last week" — the phrase that makes a delta mean something. */
    deltaContext: string;
    compare: (current: number | null | undefined, prior: number | null | undefined) => Delta;
};

/**
 * The half of a module dashboard that is not the module: window state, the three
 * requests that fill it, and the rule for what a failure costs.
 *
 * Every module Overview asks the same three questions of its endpoint — this
 * window, the one before it (for deltas), and daily buckets (for sparklines) —
 * and every one of them wants the same answer when a request fails: losing the
 * comparison window costs a "—", losing the trend costs the sparklines, and only
 * losing the overview itself costs the page. That rule was written out three
 * times in three dashboards before it lived here.
 *
 * The fetchers are held in a ref rather than depended on, because callers pass
 * inline arrows; putting them in the dependency array would reload on every
 * render.
 */
export function useModuleDashboard<TOverview, TTrend = never>({
    fetchOverview,
    fetchTrends,
    initialRange = 'month',
    unavailableMessage,
    windowKind = 'date',
}: {
    fetchOverview: (window: DateWindow) => Promise<TOverview>;
    fetchTrends?: (window: DateWindow) => Promise<{ points?: TTrend[] } | null>;
    initialRange?: DashboardRange;
    unavailableMessage: string;
    /**
     * `date` sends `YYYY-MM-DD` bounds, for endpoints that read a whole local
     * calendar day. `instant` sends ISO instants, which is what the accounting
     * endpoints have always taken — handing those a date-only bound would move
     * every Dhaka day boundary six hours and silently re-date the figures.
     */
    windowKind?: 'date' | 'instant';
}): ModuleDashboardState<TOverview, TTrend> {
    const { t } = useI18n();
    const copy = t.dashboardHome;

    const [range, setRange] = useState<DashboardRange>(initialRange);
    const [overview, setOverview] = useState<TOverview | null>(null);
    const [previous, setPrevious] = useState<TOverview | null>(null);
    const [trends, setTrends] = useState<TTrend[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchers = useRef({ fetchOverview, fetchTrends });
    fetchers.current = { fetchOverview, fetchTrends };

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError('');

            const window = windowKind === 'date' ? rangeToDateWindow(range) : rangeToWindow(range);
            const prevWindow = windowKind === 'date' ? previousDateWindow(window) : previousWindow(window);
            const { fetchOverview: loadOverview, fetchTrends: loadTrends } = fetchers.current;

            const [overviewRes, prevRes, trendRes] = await Promise.allSettled([
                loadOverview(window),
                loadOverview(prevWindow),
                loadTrends ? loadTrends(window) : Promise.resolve(null),
            ]);

            if (cancelled) return;

            if (overviewRes.status === 'fulfilled') {
                setOverview(overviewRes.value);
            } else {
                setOverview(null);
                setError(overviewRes.reason instanceof Error ? overviewRes.reason.message : unavailableMessage);
            }

            setPrevious(prevRes.status === 'fulfilled' ? prevRes.value : null);
            setTrends(trendRes.status === 'fulfilled' ? (trendRes.value?.points ?? []) : []);
            setLoading(false);
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [range, unavailableMessage, windowKind]);

    const DELTA_CONTEXT: Record<DashboardRange, string> = {
        today: copy.vsPreviousToday,
        week: copy.vsPreviousWeek,
        month: copy.vsPreviousMonth,
    };

    /** A missing figure on either side is not a 0% change — it is no comparison. */
    const compare = (current: number | null | undefined, prior: number | null | undefined): Delta =>
        current == null || prior == null ? NO_COMPARISON : periodDelta(current, prior);

    return {
        range,
        setRange,
        overview,
        previous,
        trends,
        loading,
        error,
        deltaContext: DELTA_CONTEXT[range],
        compare,
    };
}
