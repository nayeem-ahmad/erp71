import { DEFAULT_HEADER_CONFIG } from './types';
import type { PrintHeaderConfig } from './types';
import { resolveHeaderConfig } from './header';
import {
    designFor,
    dropOwnDesign,
    hasOwnDesign,
    papersWithOwnDesign,
    startOwnDesign,
    withDesignFor,
} from './paper-designs';

const main: PrintHeaderConfig = {
    ...DEFAULT_HEADER_CONFIG,
    company: { ...DEFAULT_HEADER_CONFIG.company, fontSizePt: 18 },
    lines: [{ text: 'A4 line' }],
};

describe('startOwnDesign', () => {
    it('starts the paper on a copy of what it printed', () => {
        const next = startOwnDesign(main, 'A5');

        expect(hasOwnDesign(next, 'A5')).toBe(true);
        expect(resolveHeaderConfig(next, 'A5')).toEqual(resolveHeaderConfig(main, 'A5'));
    });

    it('copies, so changing the copy leaves the main design alone', () => {
        const next = startOwnDesign(main, 'A5');
        next.paperDesigns!.A5!.lines![0]!.text = 'A5 line';

        expect(next.lines[0].text).toBe('A4 line');
    });

    it('does not nest the other papers inside the copy', () => {
        const withLetter = startOwnDesign(main, 'Letter');
        const next = startOwnDesign(withLetter, 'A5');

        expect(next.paperDesigns?.A5).not.toHaveProperty('paperDesigns');
        expect(next.paperDesigns?.Letter).toBeDefined();
    });
});

describe('designFor and withDesignFor', () => {
    it('edits the main design on a paper that follows it', () => {
        const edited = withDesignFor(main, 'A5', { ...designFor(main, 'A5'), spacingMm: 9 });

        expect(edited.spacingMm).toBe(9);
        expect(hasOwnDesign(edited, 'A5')).toBe(false);
    });

    it('edits only the paper\'s own design once it has one', () => {
        const own = startOwnDesign(main, 'A5');
        const edited = withDesignFor(own, 'A5', { ...designFor(own, 'A5'), spacingMm: 9 });

        expect(resolveHeaderConfig(edited, 'A5').spacingMm).toBe(9);
        expect(edited.spacingMm).toBe(main.spacingMm);
        expect(resolveHeaderConfig(edited, 'A4').spacingMm).toBe(main.spacingMm);
    });

    it('keeps a paper\'s own design when the main design is edited', () => {
        const own = startOwnDesign(main, 'A5');
        const edited = withDesignFor(own, 'A4', { ...designFor(own, 'A4'), spacingMm: 9 });

        expect(edited.spacingMm).toBe(9);
        expect(hasOwnDesign(edited, 'A5')).toBe(true);
        expect(resolveHeaderConfig(edited, 'A5').spacingMm).toBe(main.spacingMm);
    });

    it('fills a stored partial design from the defaults for the editor', () => {
        const stored: PrintHeaderConfig = { ...main, paperDesigns: { A5: { lines: [{ text: 'A5 line' }] } } };

        expect(designFor(stored, 'A5').company.fontSizePt).toBe(DEFAULT_HEADER_CONFIG.company.fontSizePt);
        expect(designFor(stored, 'A5').lines).toEqual([{ text: 'A5 line' }]);
    });
});

describe('dropOwnDesign', () => {
    it('puts the paper back on the main design', () => {
        const next = dropOwnDesign(startOwnDesign(startOwnDesign(main, 'A5'), 'Letter'), 'A5');

        expect(hasOwnDesign(next, 'A5')).toBe(false);
        expect(hasOwnDesign(next, 'Letter')).toBe(true);
        expect(dropOwnDesign(next, 'Letter').paperDesigns).toBeUndefined();
    });
});

describe('papersWithOwnDesign', () => {
    it('lists the papers designed separately', () => {
        expect(papersWithOwnDesign(main)).toEqual([]);
        expect(papersWithOwnDesign(startOwnDesign(main, 'Letter'))).toEqual(['Letter']);
    });
});
