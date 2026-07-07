import { computePrGreen, PrChecksSummary } from './feedback-github.service';

describe('computePrGreen', () => {
    const checks = (over: Partial<PrChecksSummary> = {}): PrChecksSummary => ({
        total: 2, passed: 2, failed: 0, pending: 0, allPassed: true, ...over,
    });

    it('is green when at least one check passed and the PR is mergeable', () => {
        expect(computePrGreen(checks(), true)).toBe(true);
    });

    it('is not green when a check failed', () => {
        expect(computePrGreen(checks({ passed: 1, failed: 1, allPassed: false }), true)).toBe(false);
    });

    it('is not green while a check is still running', () => {
        expect(computePrGreen(checks({ passed: 1, pending: 1, allPassed: false }), true)).toBe(false);
    });

    it('is not green when no checks exist yet', () => {
        expect(computePrGreen(checks({ total: 0, passed: 0, allPassed: false }), true)).toBe(false);
    });

    it('is not green when the PR has a merge conflict', () => {
        expect(computePrGreen(checks(), false)).toBe(false);
    });

    it('is not green while mergeability is still being computed (null)', () => {
        expect(computePrGreen(checks(), null)).toBe(false);
    });
});
