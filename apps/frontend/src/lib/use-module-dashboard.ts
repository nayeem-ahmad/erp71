'use client';

import { useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DashboardRange } from '@/components/dashboard/DashboardHeader';
import { dashboardQueryKey } from '@/components/dashboard/dashboard-query';
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
    /** Nothing to show yet for this window: the band's skeleton. */
    loading: boolean;
    /**
     * The figures on screen are the previous range's (or scope's) while the new
     * one loads. Feeds `ModuleDashboard`'s `refreshing`, which dims rather than
     * blanks them.
     */
    refreshing: boolean;
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
 * The three are separate cached queries rather than one `Promise.allSettled`:
 * the headline figures paint the moment the current window answers, and the
 * comparison window — which only feeds the delta arrows — fills in behind them
 * instead of holding the page. Each answer is kept per workspace, day, range and
 * `reloadKey`, so a return visit paints from memory, and a range switch keeps the
 * last range on screen (`keepPreviousData`) until the next one lands.
 *
 * The fetchers are held in a ref rather than put in the query key, because
 * callers pass inline arrows that are new on every render; `cacheKey` is what
 * names the endpoint instead.
 */
export function useModuleDashboard<TOverview, TTrend = never>({
    cacheKey,
    fetchOverview,
    fetchTrends,
    initialRange = 'month',
    unavailableMessage,
    windowKind = 'date',
    reloadKey,
    enabled = true,
}: {
    /**
     * Names this dashboard's endpoint in the cache. Required, and unique per
     * dashboard: two dashboards sharing one would answer for each other.
     */
    cacheKey: string;
    fetchOverview: (window: DateWindow) => Promise<TOverview>;
    fetchTrends?: (window: DateWindow) => Promise<{ points?: TTrend[] } | null>;
    initialRange?: DashboardRange;
    unavailableMessage: string;
    /**
     * Anything else the fetchers read that should re-run them when it changes —
     * the CRM dashboard's "only mine" scope is the one caller today.
     *
     * A scalar rather than a dependency array, because the fetchers themselves
     * live in a ref (callers pass inline arrows, which would reload every render)
     * and a fresh array would defeat the effect's dependency check the same way.
     * `undefined` means the window alone drives reloads, as it always has.
     */
    reloadKey?: string | number | boolean;
    /**
     * Holds every request until the caller is ready to ask the right question.
     *
     * The CRM dashboard's "only mine" scope is read from storage after mount, so
     * without this the page would fetch the whole team's numbers, paint them, and
     * replace them a tick later. `loading` stays true meanwhile, so what the user
     * sees is the skeleton it would have shown anyway rather than a flicker.
     */
    enabled?: boolean;
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

    const fetchers = useRef({ fetchOverview, fetchTrends });
    fetchers.current = { fetchOverview, fetchTrends };
    const hasTrends = Boolean(fetchTrends);

    // Worked out when each request is made, not put in the key: an `instant`
    // window ends "now", which would make every render a new query.
    const currentWindow = () => (windowKind === 'date' ? rangeToDateWindow(range) : rangeToWindow(range));
    const priorWindow = () => {
        const window = currentWindow();
        return windowKind === 'date' ? previousDateWindow(window) : previousWindow(window);
    };
    const keyFor = (part: 'overview' | 'previous' | 'trends') =>
        dashboardQueryKey('module', cacheKey, part, windowKind, range, reloadKey ?? null);

    const overviewQuery = useQuery({
        queryKey: keyFor('overview'),
        queryFn: () => fetchers.current.fetchOverview(currentWindow()),
        enabled,
        placeholderData: keepPreviousData,
    });
    const previousQuery = useQuery({
        queryKey: keyFor('previous'),
        queryFn: () => fetchers.current.fetchOverview(priorWindow()),
        enabled,
        placeholderData: keepPreviousData,
    });
    const trendQuery = useQuery({
        queryKey: keyFor('trends'),
        queryFn: async () => {
            const loadTrends = fetchers.current.fetchTrends;
            return loadTrends ? loadTrends(currentWindow()) : null;
        },
        enabled: enabled && hasTrends,
        placeholderData: keepPreviousData,
    });

    // Losing the overview costs the page; losing the comparison window costs a
    // "—"; losing the trend costs the sparklines.
    const overview = overviewQuery.data ?? null;
    const error = overviewQuery.isError
        ? (overviewQuery.error instanceof Error ? overviewQuery.error.message : unavailableMessage)
        : '';
    // Only paired with the figures it belongs to: while a switch is in flight one
    // of the two can still be the old range's, and an arrow comparing this week
    // against the month before is worse than no arrow.
    const previous = previousQuery.data !== undefined
        && previousQuery.isPlaceholderData === overviewQuery.isPlaceholderData
        ? previousQuery.data
        : null;
    // The sparkline is a shape, not a figure, so the last range's may stand in
    // for a moment rather than the tile collapsing and regrowing.
    const trends = trendQuery.data?.points ?? [];

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
        // `isPending` holds while disabled too, which is what `enabled` promises:
        // the skeleton the user would have seen anyway, never a flicker.
        loading: overviewQuery.isPending,
        refreshing: overviewQuery.isPlaceholderData,
        error,
        deltaContext: DELTA_CONTEXT[range],
        compare,
    };
}
