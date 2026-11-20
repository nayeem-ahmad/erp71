'use client';

import { formatMs } from '@/lib/page-timing/format';
import { PHASE_COLORS, type PhaseKey } from './phases';

export type PhaseSegment = { key: PhaseKey; label: string; ms: number };

/**
 * A page view's phases as one bar, each segment as wide as its share of the
 * total, with a 2px gap between them. Segments carry their value on hover; the
 * legend beside it is what names them, so identity never rests on color alone.
 */
export default function PhaseBar({
    segments,
    size = 'md',
    label,
}: {
    segments: PhaseSegment[];
    size?: 'sm' | 'md';
    /** Read out instead of the segments, e.g. "App start 48 ms, Data 291 ms". */
    label: string;
}) {
    const visible = segments.filter((segment) => segment.ms > 0);
    const total = visible.reduce((sum, segment) => sum + segment.ms, 0);
    const height = size === 'sm' ? 'h-2' : 'h-3';

    if (total <= 0) {
        return <div className={`${height} w-full rounded bg-gray-100`} role="img" aria-label={label} />;
    }

    return (
        <div className={`flex ${height} w-full gap-0.5`} role="img" aria-label={label}>
            {visible.map((segment) => (
                <div
                    key={segment.key}
                    className="h-full rounded-sm first:rounded-s last:rounded-e"
                    style={{
                        backgroundColor: PHASE_COLORS[segment.key],
                        flexGrow: segment.ms,
                        flexBasis: 0,
                        minWidth: 2,
                    }}
                    title={`${segment.label}: ${formatMs(segment.ms)}`}
                />
            ))}
        </div>
    );
}

export function PhaseSwatch({ phase }: { phase: PhaseKey }) {
    return (
        <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: PHASE_COLORS[phase] }}
        />
    );
}
