import { isPosEnabled } from './sales-settings';

describe('isPosEnabled', () => {
    it('defaults to enabled when settings are missing', () => {
        expect(isPosEnabled()).toBe(true);
        expect(isPosEnabled(null)).toBe(true);
        expect(isPosEnabled({})).toBe(true);
    });

    it('returns false only when pos_enabled is explicitly false', () => {
        expect(isPosEnabled({ pos_enabled: false })).toBe(false);
        expect(isPosEnabled({ pos_enabled: true })).toBe(true);
    });
});