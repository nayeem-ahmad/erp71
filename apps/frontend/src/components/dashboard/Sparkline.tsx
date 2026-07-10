'use client';

export function Sparkline({ points, className }: { points: number[]; className?: string }) {
    if (!points.length) return null;
    const w = 100;
    const h = 24;
    const max = Math.max(...points, 1);
    const min = Math.min(...points, 0);
    const range = max - min || 1;
    const step = points.length > 1 ? w / (points.length - 1) : w;
    const d = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * h).toFixed(1)}`)
        .join(' ');

    return (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`h-5 w-full ${className ?? ''}`} aria-hidden="true">
            <path d={d} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}
