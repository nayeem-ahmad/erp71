import { HIGH_THRESHOLD, MEDIUM_THRESHOLD, confidenceFor, tokenSetSimilarity } from './score';

describe('tokenSetSimilarity', () => {
    it('is 1 for identical strings', () => {
        expect(tokenSetSimilarity('napa', 'napa')).toBe(1);
    });

    it('is 0 for no shared tokens', () => {
        expect(tokenSetSimilarity('napa', 'savlon')).toBe(0);
    });

    it('scores a missing brand prefix highly (subset)', () => {
        // "napa" ⊂ "square napa" — the containment case brand drift produces.
        expect(tokenSetSimilarity('napa', 'square napa')).toBeGreaterThanOrEqual(HIGH_THRESHOLD);
    });

    it('scores partial overlap between the thresholds', () => {
        const score = tokenSetSimilarity('beximco pharma', 'beximco healthcare');
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(HIGH_THRESHOLD);
    });

    it('is symmetric', () => {
        expect(tokenSetSimilarity('napa', 'square napa')).toBe(tokenSetSimilarity('square napa', 'napa'));
    });

    it('is 0 when either side is empty', () => {
        expect(tokenSetSimilarity('', 'napa')).toBe(0);
        expect(tokenSetSimilarity('napa', '')).toBe(0);
    });
});

describe('confidenceFor', () => {
    it('is high for a single strong candidate', () => {
        expect(confidenceFor(0.95, 1)).toBe('high');
    });

    it('downgrades a strong score to medium when several candidates tie', () => {
        expect(confidenceFor(0.95, 3)).toBe('medium');
    });

    it('is medium in the middle band', () => {
        expect(confidenceFor(0.6, 1)).toBe('medium');
    });

    it('is low below the medium threshold', () => {
        expect(confidenceFor(0.2, 1)).toBe('low');
    });

    it('is none with no candidates', () => {
        expect(confidenceFor(0, 0)).toBe('none');
    });

    it('treats the thresholds as inclusive lower bounds', () => {
        expect(confidenceFor(HIGH_THRESHOLD, 1)).toBe('high');
        expect(confidenceFor(MEDIUM_THRESHOLD, 1)).toBe('medium');
    });
});
