'use client';

import { monotoneCubicPath, type Point } from '@/lib/charts/smooth-path';

const W = 100;
const H = 30;

export function Sparkline({
    points,
    positive = true,
    className,
}: {
    points: number[];
    positive?: boolean;
    className?: string;
}) {
    // A single reading has no shape to draw; the tile shows the value instead.
    if (points.length < 2) return null;

    const max = Math.max(...points);
    const min = Math.min(...points);
    // Pad the range so a flat-ish series doesn't render as a line glued to an edge.
    const pad = (max - min) * 0.25 || 1;
    const hi = max + pad;
    const lo = min - pad;
    const step = W / (points.length - 1);
    const y = (value: number) => H - ((value - lo) / (hi - lo)) * H;

    const plotted: Point[] = points.map((value, index) => ({ x: index * step, y: y(value) }));
    const line = monotoneCubicPath(plotted);
    const area = `${line} L ${W} ${H} L 0 ${H} Z`;
    const mean = points.reduce((sum, value) => sum + value, 0) / points.length;
    const meanY = y(mean);

    const stroke = positive ? 'stroke-primary' : 'stroke-series-2';
    const fill = positive ? 'fill-primary-light' : 'fill-series-2-light';

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className={`h-[30px] w-full overflow-visible ${className ?? ''}`}
            aria-hidden="true"
        >
            <line
                data-testid="sparkline-reference"
                x1={0}
                x2={W}
                y1={meanY}
                y2={meanY}
                className="stroke-gray-300"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
            />
            <path data-testid="sparkline-area" d={area} className={fill} />
            <path
                data-testid="sparkline-line"
                d={line}
                fill="none"
                className={stroke}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
            <circle
                data-testid="sparkline-endpoint"
                cx={W}
                cy={plotted[plotted.length - 1].y}
                r={3.2}
                className={`${positive ? 'fill-primary' : 'fill-series-2'} stroke-white`}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}
