/** The server's own split of one request, from its `Server-Timing` header. */
export type ServerSplit = {
    authMs: number;
    dbMs: number;
    appMs: number;
    totalMs: number;
    /** Sent to platform staff only. */
    authQueries?: number;
    dbQueries?: number;
};

/**
 * Reads `auth;dur=8;desc="1 query", db;dur=20, app;dur=6, total;dur=34`.
 * Null when the header is missing (an old backend, or a proxy that dropped it)
 * or has no total — a partial split would be read as a fast server.
 */
export function parseServerTiming(header: string | null | undefined): ServerSplit | null {
    if (!header) return null;
    const metrics = new Map<string, { dur?: number; desc?: string }>();
    for (const entry of header.split(',')) {
        const [name, ...params] = entry.trim().split(';');
        if (!name) continue;
        const metric: { dur?: number; desc?: string } = {};
        for (const param of params) {
            const [key, raw = ''] = param.trim().split('=');
            const value = raw.trim().replace(/^"(.*)"$/, '$1');
            if (key === 'dur') metric.dur = Number(value);
            if (key === 'desc') metric.desc = value;
        }
        metrics.set(name.trim(), metric);
    }
    const dur = (name: string) => {
        const value = metrics.get(name)?.dur;
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };
    const count = (name: string) => {
        const match = metrics.get(name)?.desc?.match(/^(\d+)\s/);
        return match ? Number(match[1]) : undefined;
    };
    const totalMs = dur('total');
    if (totalMs === null) return null;
    return {
        authMs: dur('auth') ?? 0,
        dbMs: dur('db') ?? 0,
        appMs: dur('app') ?? 0,
        totalMs,
        authQueries: count('auth'),
        dbQueries: count('db'),
    };
}
