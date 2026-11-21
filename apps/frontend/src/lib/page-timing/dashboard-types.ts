import type { NavType } from './collector';

/** One row of `GET /admin/page-timings`: medians of each phase, percentiles of the total. */
export type PageTimingStats = {
    views: number;
    p50_ms: number | null;
    p75_ms: number | null;
    p95_ms: number | null;
    document_ms: number | null;
    boot_ms: number | null;
    data_ms: number | null;
    render_ms: number | null;
    network_ms: number | null;
    server_ms: number | null;
    db_ms: number | null;
    api_calls: number | null;
};

export type PageTimingRouteStats = PageTimingStats & {
    route: string;
    slowest_endpoint: string | null;
};

export type PageTimingSummary = {
    days: number;
    nav_type: NavType | null;
    overall: PageTimingStats;
    routes: PageTimingRouteStats[];
};

export const PAGE_TIMING_WINDOWS = [1, 7, 30] as const;
export type PageTimingWindow = (typeof PAGE_TIMING_WINDOWS)[number];
