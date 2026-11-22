/** `412 ms`, `1.24 s`, `12.5 s`. */
export function formatMs(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const ms = Math.max(0, value);
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** How a total reads at a glance: under 1 s is fine, over 3 s is slow. */
export type SpeedTone = 'ok' | 'slow' | 'bad';

export function speedTone(ms: number | null | undefined): SpeedTone {
    if (ms === null || ms === undefined) return 'ok';
    if (ms >= 3000) return 'bad';
    if (ms >= 1000) return 'slow';
    return 'ok';
}

export const SPEED_TEXT: Record<SpeedTone, string> = {
    ok: 'text-gray-700',
    slow: 'text-amber-700',
    bad: 'text-red-700',
};
