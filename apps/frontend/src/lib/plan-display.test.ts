import { formatPlanDisplayName } from './plan-display';

describe('formatPlanDisplayName', () => {
    it('returns null when plan code is missing', () => {
        expect(formatPlanDisplayName(null)).toBeNull();
        expect(formatPlanDisplayName({ code: null })).toBeNull();
    });

    it('title-cases raw plan codes', () => {
        expect(formatPlanDisplayName({ code: 'ACCOUNTING' })).toBe('Accounting');
    });

    it('prefers a distinct plan name when provided', () => {
        expect(formatPlanDisplayName({ code: 'STANDARD', name: 'Standard Plan' })).toBe('Standard Plan');
    });
});