/**
 * Shared visual vocabulary for the referral partner charts.
 *
 * Exactly two hues, validated against both the light and dark chart surfaces for
 * lightness band, chroma floor, CVD separation, normal-vision separation and
 * contrast. Their tritan separation is ΔE 7.5 — inside the 6–8 floor band — which
 * is why every chart using both MUST also carry a legend and direct labels. Hue
 * alone is not a sufficient encoding here. Do not add a third series colour.
 */
export const CHART_BLUE = '#2563eb';
export const CHART_EMERALD = '#047857';
export const CHART_BLUE_FILL = '#eff6ff';
export const CHART_EMERALD_FILL = '#ecfdf5';

export const CHART_GRID = '#f3f4f6';
export const CHART_AXIS_TEXT = '#9ca3af';

/** Rounds a magnitude up to a 1/2/2.5/5 × 10ⁿ step so axis ticks read cleanly. */
export function niceStep(value: number): number {
    if (value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 2.5) return 2.5 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

/** Axis-tick abbreviation using the lakh convention BD readers expect. */
export function compactNumber(value: number): string {
    const magnitude = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (magnitude >= 100_000) {
        const lakh = magnitude / 100_000;
        return `${sign}${lakh.toFixed(magnitude % 100_000 === 0 ? 0 : 1)}L`;
    }
    if (magnitude >= 1_000) return `${sign}${Math.round(magnitude / 1_000)}k`;
    return String(Math.round(value));
}
