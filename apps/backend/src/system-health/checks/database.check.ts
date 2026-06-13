import { Injectable } from '@nestjs/common';
import type { CheckResult } from '@retail-saas/shared-types';
import { DatabaseService } from '../../database/database.service';

/** Latency (ms) above which the database is considered degraded. */
const DB_LATENCY_DEGRADED_MS = parseInt(process.env.HEALTH_DB_LATENCY_DEGRADED_MS ?? '1000', 10);
/** Connection-pool utilisation above which the database is considered degraded. */
const DB_POOL_DEGRADED_PCT = parseInt(process.env.HEALTH_DB_POOL_DEGRADED_PCT ?? '80', 10);

interface PoolRow {
    total: number;
    active: number;
    max_connections: number;
    db_size: number;
}

/**
 * Checks PostgreSQL connectivity, query latency, and connection-pool
 * saturation. This is the only `critical` dependency: if it is down, the
 * whole system is down.
 */
@Injectable()
export class DatabaseCheck {
    constructor(private readonly db: DatabaseService) {}

    async run(): Promise<CheckResult> {
        const base: Pick<CheckResult, 'name' | 'label' | 'critical'> = {
            name: 'database',
            label: 'PostgreSQL',
            critical: true,
        };

        const start = Date.now();
        try {
            // Cast bigints so the JSON serializer doesn't choke on BigInt values.
            const rows = await this.db.$queryRaw<PoolRow[]>`
                SELECT
                    count(*)::int AS total,
                    count(*) FILTER (WHERE state = 'active')::int AS active,
                    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
                    pg_database_size(current_database())::float8 AS db_size
                FROM pg_stat_activity
            `;
            const latency_ms = Date.now() - start;
            const row = rows[0];

            const usedPct = row.max_connections > 0
                ? Math.round((row.total / row.max_connections) * 100)
                : 0;

            const details = {
                connections_used: row.total,
                connections_active: row.active,
                max_connections: row.max_connections,
                pool_used_pct: usedPct,
                db_size_bytes: row.db_size,
            };

            if (usedPct >= DB_POOL_DEGRADED_PCT) {
                return {
                    ...base,
                    state: 'degraded',
                    latency_ms,
                    message: `Connection pool at ${usedPct}% (${row.total}/${row.max_connections})`,
                    details,
                };
            }

            if (latency_ms >= DB_LATENCY_DEGRADED_MS) {
                return {
                    ...base,
                    state: 'degraded',
                    latency_ms,
                    message: `Query latency ${latency_ms}ms exceeds ${DB_LATENCY_DEGRADED_MS}ms`,
                    details,
                };
            }

            return { ...base, state: 'ok', latency_ms, details };
        } catch (err) {
            return {
                ...base,
                state: 'down',
                latency_ms: Date.now() - start,
                message: err instanceof Error ? err.message : 'Database unreachable',
            };
        }
    }
}
