import { DEFAULT_HEADER_CONFIG } from './types';
import type { PaperSize, PrintHeaderConfig } from './types';
import { headerCss, renderFooterHtml, renderHeaderHtml, resolveHeaderConfig } from './header';
import {
    copyDesignFrom,
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

describe('a roll designed separately', () => {
    const ctx = { docTitle: 'Receipt', docNumber: 'R-1', companyName: 'Rahim Traders', address: 'Motijheel' };
    const sheet: PrintHeaderConfig = {
        ...DEFAULT_HEADER_CONFIG,
        layout: 'logo-left',
        logo: { url: 'https://cdn.test/logo.png', heightMm: 30, showOnThermal: false },
        company: { ...DEFAULT_HEADER_CONFIG.company, fontSizePt: 24 },
        title: { ...DEFAULT_HEADER_CONFIG.title, fontSizePt: 22, position: 'beside-right', offsetXMm: 6 },
        qr: { ...DEFAULT_HEADER_CONFIG.qr, sizeMm: 50 },
        images: [
            { url: 'https://cdn.test/badge.png', heightMm: 12, showOnThermal: true },
            { url: 'https://cdn.test/a4-only.png', heightMm: 12 },
        ],
        footer: {
            ...DEFAULT_HEADER_CONFIG.footer,
            show: true,
            lines: [{ text: 'Thank you' }],
            images: [{ url: 'https://cdn.test/seal.png', heightMm: 12 }],
            repeatOnEveryPage: true,
            bleed: true,
        },
    };
    const printed = (config: PrintHeaderConfig, paper: PaperSize) => [
        renderHeaderHtml(config, ctx, paper),
        renderFooterHtml(config, ctx, paper),
        headerCss(config, paper),
    ];

    it.each(['Thermal80', 'Thermal58'] as const)('starts %s on exactly what it printed', (paper) => {
        for (const config of [sheet, { ...sheet, layout: 'text-only' as const }]) {
            const next = startOwnDesign(config, paper);

            expect(hasOwnDesign(next, paper)).toBe(true);
            expect(printed(next, paper)).toEqual(printed(config, paper));
        }
    });

    it('is listed with the papers designed separately', () => {
        expect(papersWithOwnDesign(startOwnDesign(main, 'Thermal58'))).toEqual(['Thermal58']);
    });

    it('shows the editor its design as stored, not as the roll limits it', () => {
        const stored: PrintHeaderConfig = { ...main, paperDesigns: { Thermal80: { qr: { sizeMm: 50 } } } };

        expect(designFor(stored, 'Thermal80').qr.sizeMm).toBe(50);
    });

    describe('copying one roll\'s design onto the other', () => {
        const with80: PrintHeaderConfig = {
            ...main,
            paperDesigns: {
                Thermal80: {
                    layout: 'logo-left',
                    logo: { url: 'https://cdn.test/roll-logo.png', heightMm: 25, showOnThermal: false },
                    company: { fontSizePt: 20 },
                    lines: [{ text: '80mm line' }],
                },
            },
        };

        it('gives 58mm the 80mm design, shrunk to fit the narrower roll', () => {
            const next = copyDesignFrom(with80, 'Thermal58', 'Thermal80');
            const resolved = resolveHeaderConfig(next, 'Thermal58');

            expect(hasOwnDesign(next, 'Thermal58')).toBe(true);
            expect(resolved.layout).toBe('logo-above');
            expect(resolved.company.fontSizePt).toBe(12);
            expect(resolved.logo).toMatchObject({ url: 'https://cdn.test/roll-logo.png', heightMm: 10 });
            expect(resolved.lines).toEqual([{ text: '80mm line' }]);
        });

        it('copies, so editing 58mm leaves 80mm alone', () => {
            const next = copyDesignFrom(with80, 'Thermal58', 'Thermal80');
            next.paperDesigns!.Thermal58!.lines![0]!.text = '58mm line';

            expect(resolveHeaderConfig(next, 'Thermal80').lines).toEqual([{ text: '80mm line' }]);
            expect(next.paperDesigns?.Thermal58).not.toHaveProperty('paperDesigns');
        });
    });
});
