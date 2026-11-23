import {
    AI_TOKENS_PER_CREDIT,
    BILL_SCAN_TOKENS_PER_CREDIT,
    documentExpiryState,
    estimateBillScanCredits,
} from './index';

describe('estimateBillScanCredits', () => {
    it('uses the same tokens-per-credit as the AI usage log', () => {
        expect(BILL_SCAN_TOKENS_PER_CREDIT).toBe(AI_TOKENS_PER_CREDIT);
    });

    it('prices a 1600×1200 photo at a few credits, with a higher ceiling', () => {
        const estimate = estimateBillScanCredits(1600, 1200);
        expect(estimate.expected).toBeGreaterThan(3);
        expect(estimate.expected).toBeLessThan(5);
        expect(estimate.max).toBeGreaterThan(estimate.expected);
    });

    it('caps a huge photo at what the model would shrink it to', () => {
        expect(estimateBillScanCredits(8000, 6000)).toEqual(estimateBillScanCredits(1568, 1176));
    });

    it('charges less for a smaller photo', () => {
        expect(estimateBillScanCredits(800, 600).expected).toBeLessThan(estimateBillScanCredits(1600, 1200).expected);
    });
});

describe('documentExpiryState', () => {
    const today = new Date(2026, 10, 22);

    it('reads no date as none', () => {
        expect(documentExpiryState(null, 30, today)).toEqual({ state: 'none', daysLeft: null });
    });

    it('is valid outside the reminder window', () => {
        expect(documentExpiryState('2027-03-01', 30, today).state).toBe('valid');
    });

    it('is expiring inside the window, and on the day itself', () => {
        expect(documentExpiryState('2026-12-10', 30, today)).toEqual({ state: 'expiring', daysLeft: 18 });
        expect(documentExpiryState('2026-11-22', 30, today)).toEqual({ state: 'expiring', daysLeft: 0 });
    });

    it('is expired the day after', () => {
        expect(documentExpiryState('2026-11-21', 30, today)).toEqual({ state: 'expired', daysLeft: -1 });
    });
});
