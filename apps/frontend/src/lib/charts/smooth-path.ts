export type Point = { x: number; y: number };

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Builds an SVG path through `points` using monotone cubic interpolation
 * (Fritsch–Carlson tangents).
 *
 * A plain cardinal/Catmull-Rom spline overshoots around turning points, which on
 * a financial chart draws peaks and dips that aren't in the data — a curve
 * dipping below zero on a day that never went negative. Monotone cubic clamps
 * the tangents so each segment stays within its own endpoints.
 *
 * Points must be sorted by ascending `x`.
 */
export function monotoneCubicPath(points: Point[]): string {
    const n = points.length;
    if (n === 0) return '';
    if (n === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    if (n === 2) return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;

    const dx: number[] = [];
    const slope: number[] = [];
    for (let i = 0; i < n - 1; i += 1) {
        dx[i] = points[i + 1].x - points[i].x;
        slope[i] = (points[i + 1].y - points[i].y) / dx[i];
    }

    // Tangent at each point: zero at a local extremum (which is what kills the
    // overshoot), otherwise a weighted harmonic mean of the neighbouring slopes.
    const tangent: number[] = [slope[0]];
    for (let i = 1; i < n - 1; i += 1) {
        if (slope[i - 1] * slope[i] <= 0) {
            tangent[i] = 0;
        } else {
            const w1 = 2 * dx[i] + dx[i - 1];
            const w2 = dx[i] + 2 * dx[i - 1];
            tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
        }
    }
    tangent[n - 1] = slope[n - 2];

    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    for (let i = 0; i < n - 1; i += 1) {
        const third = dx[i] / 3;
        const c1x = points[i].x + third;
        const c1y = points[i].y + tangent[i] * third;
        const c2x = points[i + 1].x - third;
        const c2y = points[i + 1].y - tangent[i + 1] * third;
        d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(points[i + 1].x)} ${fmt(points[i + 1].y)}`;
    }
    return d;
}
