import {
    ATTRIBUTION_WINDOW_DAYS,
    clearReferralCode,
    recallReferralCode,
    rememberReferralCode,
} from './referral-attribution';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Someone clicks a partner's link today and signs up on Thursday. Without this the
 * signup is attributed to nobody and the partner is not paid — which was the
 * behaviour until now, since the code only survived as a query parameter.
 */
describe('referral attribution', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('recalls a code stored moments ago', () => {
        rememberReferralCode('RAHMA1B2C3', 1_000);

        expect(recallReferralCode(2_000)).toBe('RAHMA1B2C3');
    });

    it('normalises what it stores, so a lower-case link still matches', () => {
        rememberReferralCode('  rahma1b2c3  ', 1_000);

        expect(recallReferralCode(2_000)).toBe('RAHMA1B2C3');
    });

    it('still recalls a code just inside the attribution window', () => {
        const now = 1_000_000_000;
        rememberReferralCode('RAHMA1B2C3', now);

        const justInside = now + ATTRIBUTION_WINDOW_DAYS * DAY_MS - 1;
        expect(recallReferralCode(justInside)).toBe('RAHMA1B2C3');
    });

    it('forgets a code past the attribution window', () => {
        const now = 1_000_000_000;
        rememberReferralCode('RAHMA1B2C3', now);

        const justOutside = now + ATTRIBUTION_WINDOW_DAYS * DAY_MS + 1;
        expect(recallReferralCode(justOutside)).toBeNull();
    });

    it('clears an expired code rather than leaving it to be re-checked forever', () => {
        const now = 1_000_000_000;
        rememberReferralCode('RAHMA1B2C3', now);
        recallReferralCode(now + (ATTRIBUTION_WINDOW_DAYS + 1) * DAY_MS);

        expect(window.localStorage.getItem('erp71.referral')).toBeNull();
    });

    it('lets the most recent link win', () => {
        rememberReferralCode('FIRST00001', 1_000);
        rememberReferralCode('SECOND0002', 2_000);

        expect(recallReferralCode(3_000)).toBe('SECOND0002');
    });

    it('returns null when nothing was ever stored', () => {
        expect(recallReferralCode()).toBeNull();
    });

    it('ignores an empty code instead of storing a blank attribution', () => {
        rememberReferralCode('   ', 1_000);

        expect(recallReferralCode(2_000)).toBeNull();
    });

    it('survives unparseable storage rather than throwing into the signup page', () => {
        window.localStorage.setItem('erp71.referral', 'not json');

        expect(recallReferralCode()).toBeNull();
    });

    it('ignores a stored value missing its timestamp', () => {
        window.localStorage.setItem('erp71.referral', JSON.stringify({ code: 'RAHMA1B2C3' }));

        expect(recallReferralCode()).toBeNull();
    });

    it('clears on request', () => {
        rememberReferralCode('RAHMA1B2C3', 1_000);
        clearReferralCode();

        expect(recallReferralCode(2_000)).toBeNull();
    });
});
