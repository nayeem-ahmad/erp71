export type Delta = { label: string; positive: boolean };

const NO_COMPARISON: Delta = { label: '—', positive: true };

/**
 * Compares a KPI against the same figure for the previous period.
 *
 * The dashboard previously compared the first and last point of the current
 * series, which made a single quiet day flip a KPI's direction without anything
 * changing in the business.
 */
export function periodDelta(current: number, previous: number): Delta {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return NO_COMPARISON;
    // Percent change from zero is undefined; showing "100%" would be an invention.
    if (previous === 0) return NO_COMPARISON;

    const change = Math.round(((current - previous) / Math.abs(previous)) * 100);
    if (change === 0) return { label: '0%', positive: true };

    const positive = change > 0;
    return { label: `${positive ? '▲' : '▼'} ${Math.abs(change)}%`, positive };
}
