import { DEFAULT_HEADER_CONFIG } from './types';
import type { PrintHeaderConfig } from './types';
import { renderHeaderHtml, resolveHeaderConfig } from './header';
import {
    clearPaperOverrides,
    PAPER_SIZE_FIELDS,
    paperOverride,
    papersWithOverrides,
    paperSizeValue,
    setPaperOverride,
} from './paper-overrides';

const base: PrintHeaderConfig = {
    ...DEFAULT_HEADER_CONFIG,
    logo: { ...DEFAULT_HEADER_CONFIG.logo, heightMm: 18 },
    company: { ...DEFAULT_HEADER_CONFIG.company, fontSizePt: 16 },
};

describe('paperSizeValue', () => {
    it('reads each size from the main design', () => {
        expect(paperSizeValue(base, 'logoHeightMm')).toBe(18);
        expect(paperSizeValue(base, 'companyFontSizePt')).toBe(16);
        expect(paperSizeValue(base, 'titleFontSizePt')).toBe(20);
        expect(paperSizeValue(base, 'spacingMm')).toBe(4);
        expect(paperSizeValue(base, 'qrSizeMm')).toBe(20);
    });

    it('reads an unset line scale as 100%', () => {
        expect(paperSizeValue(base, 'lineScalePct')).toBe(100);
    });
});

describe('setPaperOverride', () => {
    it('stores the size under that paper only', () => {
        const next = setPaperOverride(base, 'A5', 'companyFontSizePt', 12);

        expect(paperOverride(next, 'A5', 'companyFontSizePt')).toBe(12);
        expect(next.company.fontSizePt).toBe(16);
        expect(resolveHeaderConfig(next, 'A5').company.fontSizePt).toBe(12);
        expect(resolveHeaderConfig(next, 'A4').company.fontSizePt).toBe(16);
        expect(resolveHeaderConfig(next, 'Letter').company.fontSizePt).toBe(16);
    });

    it('keeps the rest of the section shared', () => {
        // Only the size is overridden; A5 still follows the colour set for A4.
        const next = setPaperOverride(base, 'A5', 'companyFontSizePt', 12);
        const changedColour = { ...next, company: { ...next.company, color: '#dc2626' } };

        expect(resolveHeaderConfig(changedColour, 'A5').company.color).toBe('#dc2626');
    });

    it('stores every field where the renderer reads it', () => {
        let next = base;
        for (const field of PAPER_SIZE_FIELDS) next = setPaperOverride(next, 'A5', field, 11);

        expect(next.perPaper?.A5).toEqual({
            logo: { heightMm: 11 },
            company: { fontSizePt: 11 },
            title: { fontSizePt: 11 },
            lineScalePct: 11,
            spacingMm: 11,
            qr: { sizeMm: 11 },
        });
    });

    it('prints the overridden sizes on that paper', () => {
        const next = setPaperOverride(setPaperOverride(base, 'A5', 'lineScalePct', 80), 'A5', 'logoHeightMm', 12);

        // The default lines are all tokens, and a line with nothing to print is dropped.
        const ctx = { companyName: 'Rahim Traders', address: '12 Motijheel, Dhaka' };

        expect(renderHeaderHtml(next, ctx, 'A5')).toContain('font-size:7.2pt');
        expect(renderHeaderHtml(next, ctx, 'A4')).toContain('font-size:9pt');
    });

    it('drops the override, and the empty sections around it, when cleared', () => {
        const set = setPaperOverride(base, 'A5', 'qrSizeMm', 14);
        const cleared = setPaperOverride(set, 'A5', 'qrSizeMm', undefined);

        expect(paperOverride(cleared, 'A5', 'qrSizeMm')).toBeUndefined();
        expect(cleared.perPaper).toBeUndefined();
    });

    it('leaves another paper and settings it does not manage alone', () => {
        const stored: PrintHeaderConfig = {
            ...base,
            perPaper: { A5: { company: { color: '#000000' } }, Thermal58: { logo: { showOnThermal: false } } },
        };

        const next = setPaperOverride(
            setPaperOverride(stored, 'A5', 'companyFontSizePt', 12),
            'A5',
            'companyFontSizePt',
            undefined,
        );

        expect(next.perPaper).toEqual(stored.perPaper);
    });

    it('does not change the config it was given', () => {
        const before = JSON.stringify(base);
        setPaperOverride(base, 'A5', 'spacingMm', 2);

        expect(JSON.stringify(base)).toBe(before);
    });
});

describe('clearPaperOverrides', () => {
    it('returns the paper to the main design', () => {
        let next = setPaperOverride(base, 'A5', 'logoHeightMm', 10);
        next = setPaperOverride(next, 'A5', 'lineScalePct', 85);
        next = setPaperOverride(next, 'Letter', 'spacingMm', 6);

        const cleared = clearPaperOverrides(next, 'A5');

        expect(cleared.perPaper).toEqual({ Letter: { spacingMm: 6 } });
    });
});

describe('papersWithOverrides', () => {
    it('lists the papers that print their own sizes', () => {
        expect(papersWithOverrides(base)).toEqual([]);

        const next = setPaperOverride(base, 'Letter', 'titleFontSizePt', 18);

        expect(papersWithOverrides(next)).toEqual(['Letter']);
    });
});
