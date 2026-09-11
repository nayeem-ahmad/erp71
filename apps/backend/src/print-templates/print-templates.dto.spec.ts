import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePrintTemplateDto } from './print-templates.dto';

/**
 * The letterhead config lands in a print window as HTML and CSS, so it is
 * validated field by field rather than stored as opaque JSON. These cases pin
 * the parts the renderer would otherwise have to trust, under the same pipe
 * options `main.ts` runs globally.
 */
describe('CreatePrintTemplateDto', () => {
    const parse = (config: Record<string, unknown>) =>
        validate(
            plainToInstance(CreatePrintTemplateDto, { name: 'Letterhead', config }),
            { whitelist: true, forbidNonWhitelisted: true },
        );

    /** The smallest config the DTO accepts — v1, header only. */
    const base = {
        version: 1,
        layout: 'logo-left',
        logo: { heightMm: 16, showOnThermal: true },
        company: { show: true, fontSizePt: 16, bold: true, color: '#1d4ed8' },
        title: { show: true, fontSizePt: 20, uppercase: true, letterSpacingPx: 2, color: '#1d4ed8' },
        lines: [],
        rule: { show: true, thicknessPx: 2, color: '#1d4ed8' },
        fontFamily: 'sans',
        baseFontSizePt: 10,
        spacingMm: 4,
    };

    const footer = {
        show: true,
        lines: [{ text: 'Bank: BRAC 1234' }],
        images: [],
        rule: { show: true, thicknessPx: 1, color: '#d1d5db' },
        spacingMm: 4,
        repeatOnEveryPage: false,
    };

    it('accepts a stored v1 config that has no footer or images', async () => {
        expect(await parse(base)).toHaveLength(0);
    });

    it('accepts a v2 config carrying a footer and images', async () => {
        expect(
            await parse({
                ...base,
                version: 2,
                images: [{ url: 'https://cdn.example.com/seal.png', heightMm: 14, align: 'right' }],
                footer,
            }),
        ).toHaveLength(0);
    });

    it('rejects a version the renderer does not know', async () => {
        expect((await parse({ ...base, version: 3 })).length).toBeGreaterThan(0);
    });

    describe('images', () => {
        it('accepts a caption with no url — the blank signature line', async () => {
            expect(
                await parse({ ...base, images: [{ heightMm: 12, caption: 'Authorised Signature' }] }),
            ).toHaveLength(0);
        });

        it.each([
            ['a javascript: url', { url: 'javascript:alert(1)', heightMm: 12 }],
            ['a height above the printable range', { heightMm: 500 }],
            ['an alignment that is not a keyword', { heightMm: 12, align: 'left;position:fixed' }],
        ])('rejects %s', async (_label, image) => {
            expect((await parse({ ...base, images: [image] })).length).toBeGreaterThan(0);
        });
    });

    describe('footer', () => {
        it('rejects a footer missing the flags the renderer reads', async () => {
            const { show, ...withoutShow } = footer;
            expect((await parse({ ...base, footer: withoutShow })).length).toBeGreaterThan(0);
        });

        it('rejects a non-hex divider colour', async () => {
            expect(
                (await parse({ ...base, footer: { ...footer, rule: { ...footer.rule, color: 'red' } } })).length,
            ).toBeGreaterThan(0);
        });

        it('rejects a footer line with an unknown font', async () => {
            expect(
                (await parse({ ...base, footer: { ...footer, lines: [{ text: 'x', fontFamily: 'comic' }] } })).length,
            ).toBeGreaterThan(0);
        });
    });

    describe('line formatting', () => {
        it('accepts underline, a per-line font and letter spacing', async () => {
            expect(
                await parse({
                    ...base,
                    lines: [{ text: 'Terms', underline: true, fontFamily: 'serif', letterSpacingPx: 3 }],
                }),
            ).toHaveLength(0);
        });

        it('rejects letter spacing beyond what the renderer clamps to', async () => {
            expect(
                (await parse({ ...base, lines: [{ text: 'Terms', letterSpacingPx: 99 }] })).length,
            ).toBeGreaterThan(0);
        });
    });
});
