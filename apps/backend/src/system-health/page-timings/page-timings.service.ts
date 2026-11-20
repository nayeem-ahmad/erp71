import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@erp71/database';
import { DatabaseService } from '../../database/database.service';
import type { PageNavType, PageTimingSampleDto } from './page-timings.dto';

/** How long samples are kept. The dashboard offers at most 30 days. */
export const PAGE_TIMING_RETENTION_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** Routes the dashboard lists, busiest first. */
const MAX_ROUTES = 100;

export type PageTimingStats = {
    views: number;
    p50_ms: number | null;
    p75_ms: number | null;
    p95_ms: number | null;
    /** Medians of each phase, so a row reads "where does a typical view spend its time". */
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
    /** The endpoint most often slowest on this page. */
    slowest_endpoint: string | null;
};

export type PageTimingSummary = {
    days: number;
    nav_type: PageNavType | null;
    overall: PageTimingStats;
    routes: PageTimingRouteStats[];
};

type StatsRow = { [K in keyof PageTimingStats]: number | bigint | null };

function toStats(row: StatsRow | undefined): PageTimingStats {
    const num = (value: number | bigint | null | undefined) =>
        value === null || value === undefined ? null : Math.round(Number(value));
    return {
        views: num(row?.views) ?? 0,
        p50_ms: num(row?.p50_ms),
        p75_ms: num(row?.p75_ms),
        p95_ms: num(row?.p95_ms),
        document_ms: num(row?.document_ms),
        boot_ms: num(row?.boot_ms),
        data_ms: num(row?.data_ms),
        render_ms: num(row?.render_ms),
        network_ms: num(row?.network_ms),
        server_ms: num(row?.server_ms),
        db_ms: num(row?.db_ms),
        api_calls: num(row?.api_calls),
    };
}

const STATS_COLUMNS = Prisma.sql`
    COUNT(*)::int AS views,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms) AS p50_ms,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY total_ms) AS p75_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms) AS p95_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY document_ms) AS document_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY boot_ms) AS boot_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY data_ms) AS data_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY render_ms) AS render_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY network_ms) AS network_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY server_ms) AS server_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY db_ms) AS db_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY api_calls) AS api_calls`;

/**
 * Real-user page timings: the browser reports each page view it measured, and
 * the platform team reads them back as percentiles per page.
 */
@Injectable()
export class PageTimingsService {
    private readonly logger = new Logger(PageTimingsService.name);
    private lastPruneAt = 0;

    constructor(private readonly db: DatabaseService) {}

    async record(samples: PageTimingSampleDto[]): Promise<{ recorded: number }> {
        const { count } = await this.db.pageTimingSample.createMany({
            data: samples.map((s) => ({
                route: s.route,
                nav_type: s.nav_type,
                total_ms: s.total_ms,
                document_ms: s.document_ms ?? null,
                boot_ms: s.boot_ms,
                data_ms: s.data_ms,
                render_ms: s.render_ms,
                api_calls: s.api_calls,
                network_ms: s.network_ms,
                server_ms: s.server_ms,
                db_ms: s.db_ms,
                token_wait_ms: s.token_wait_ms,
                slowest_endpoint: s.slowest_endpoint ?? null,
                slowest_ms: s.slowest_ms ?? null,
            })),
        });
        this.pruneIfDue();
        return { recorded: count };
    }

    async summary(days = 7, navType: PageNavType | null = null, now = new Date()): Promise<PageTimingSummary> {
        const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const where = navType
            ? Prisma.sql`WHERE created_at >= ${since} AND nav_type = ${navType}`
            : Prisma.sql`WHERE created_at >= ${since}`;

        const [overallRows, routeRows] = await Promise.all([
            this.db.$queryRaw<StatsRow[]>(Prisma.sql`SELECT ${STATS_COLUMNS} FROM "PageTimingSample" ${where}`),
            this.db.$queryRaw<(StatsRow & { route: string; slowest_endpoint: string | null })[]>(Prisma.sql`
                SELECT route, ${STATS_COLUMNS},
                    mode() WITHIN GROUP (ORDER BY slowest_endpoint) AS slowest_endpoint
                FROM "PageTimingSample" ${where}
                GROUP BY route
                ORDER BY views DESC, route
                LIMIT ${MAX_ROUTES}`),
        ]);

        return {
            days,
            nav_type: navType,
            overall: toStats(overallRows[0]),
            routes: routeRows.map((row) => ({
                route: row.route,
                ...toStats(row),
                slowest_endpoint: row.slowest_endpoint ?? null,
            })),
        };
    }

    /** Drops samples past retention, at most hourly, off the request path. */
    private pruneIfDue(now = Date.now()): void {
        if (now - this.lastPruneAt < PRUNE_EVERY_MS) return;
        this.lastPruneAt = now;
        const cutoff = new Date(now - PAGE_TIMING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        this.db.pageTimingSample
            .deleteMany({ where: { created_at: { lt: cutoff } } })
            .catch((error: unknown) => this.logger.warn(`Pruning page timings failed: ${String(error)}`));
    }
}
