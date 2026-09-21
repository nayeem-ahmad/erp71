export type Confidence = 'high' | 'medium' | 'low' | 'none';

/**
 * Tuned against the first real dry run rather than guessed — see the spec.
 * Raising HIGH sends more rows to review; lowering it auto-accepts more.
 */
export const HIGH_THRESHOLD = 0.85;
export const MEDIUM_THRESHOLD = 0.45;

/** Containment dominates, because a missing brand prefix is a subset, not an error. */
const CONTAINMENT_WEIGHT = 0.75;
const JACCARD_WEIGHT = 1 - CONTAINMENT_WEIGHT;

/**
 * Overlap-weighted token similarity.
 *
 * Plain Jaccard punishes a missing brand prefix: {napa} vs {square, napa} is
 * 1/2, which would push a correct match below any useful threshold. But
 * containment is exactly the shape brand drift takes, so the score leans on the
 * containment ratio (shared / smaller side) and uses Jaccard only to temper it,
 * which reads a subset as a near-match while still separating unrelated names.
 *
 * "napa" vs "square napa"     → 0.5 * 0.25 + 1.0  * 0.75 = 0.875  (high)
 * "beximco pharma" vs
 *   "beximco healthcare"      → ~0.33 * 0.25 + 0.5 * 0.75 = 0.458 (medium)
 */
export function tokenSetSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(' ').filter(Boolean));
    const setB = new Set(b.split(' ').filter(Boolean));
    if (setA.size === 0 || setB.size === 0) return 0;

    let shared = 0;
    for (const token of setA) if (setB.has(token)) shared++;
    if (shared === 0) return 0;

    const union = setA.size + setB.size - shared;
    const jaccard = shared / union;
    const containment = shared / Math.min(setA.size, setB.size);

    return jaccard * JACCARD_WEIGHT + containment * CONTAINMENT_WEIGHT;
}

/**
 * Several near-equal candidates mean the machine cannot choose, however high
 * the top score — that is precisely a human's call, so it lands in `medium`
 * rather than auto-accepting the first one that happened to sort highest.
 */
export function confidenceFor(score: number, candidateCount: number): Confidence {
    if (candidateCount === 0) return 'none';
    if (score >= HIGH_THRESHOLD) return candidateCount > 1 ? 'medium' : 'high';
    if (score >= MEDIUM_THRESHOLD) return 'medium';
    return 'low';
}
