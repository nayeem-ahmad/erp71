import {
    normalizeBrandColor,
    readableForeground,
    storefrontTheme,
    STOREFRONT_DEFAULT_ACCENT,
} from './storefront-theme';

describe('normalizeBrandColor', () => {
    it('accepts six-digit hex, case-insensitively', () => {
        expect(normalizeBrandColor('#1D4ED8')).toBe('#1d4ed8');
    });

    it('expands three-digit hex', () => {
        expect(normalizeBrandColor('#abc')).toBe('#aabbcc');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeBrandColor('  #1d4ed8  ')).toBe('#1d4ed8');
    });

    it.each([null, undefined, '', '   '])('treats %p as unset', (value) => {
        expect(normalizeBrandColor(value)).toBeNull();
    });

    // The value is free text on a settings form and is interpolated into inline
    // CSS. Anything that is not a plain hex colour is dropped rather than
    // escaped, so a tenant cannot push declarations into the storefront.
    it.each([
        'red',
        'rgb(255, 0, 0)',
        'var(--x)',
        '#1d4ed8; background-image: url(https://evil.example/x)',
        '#12345',
        '#1234567',
        '#ggg',
        'javascript:alert(1)',
    ])('rejects %p', (value) => {
        expect(normalizeBrandColor(value)).toBeNull();
    });
});

describe('readableForeground', () => {
    it('puts white on a dark brand', () => {
        expect(readableForeground('#1d4ed8')).toBe('#ffffff');
        expect(readableForeground('#000000')).toBe('#ffffff');
    });

    it('puts near-black on a pale brand', () => {
        expect(readableForeground('#ffffff')).toBe('#111827');
        expect(readableForeground('#fde047')).toBe('#111827');
    });

    // The reason luminance is gamma-corrected rather than a channel average:
    // mid-green is bright enough to need dark text, and an average calls it dark.
    it('reads mid-green as light', () => {
        expect(readableForeground('#22c55e')).toBe('#111827');
    });
});

describe('storefrontTheme', () => {
    it('falls back to the storefront default when the shop has set no colour', () => {
        expect(storefrontTheme(null)).toEqual({
            accent: STOREFRONT_DEFAULT_ACCENT,
            accentForeground: '#ffffff',
        });
    });

    it('falls back when the stored value is not a colour at all', () => {
        expect(storefrontTheme('chartreuse').accent).toBe(STOREFRONT_DEFAULT_ACCENT);
    });

    it('pairs a shop colour with a foreground that stays legible on it', () => {
        expect(storefrontTheme('#fde047')).toEqual({
            accent: '#fde047',
            accentForeground: '#111827',
        });
    });
});
