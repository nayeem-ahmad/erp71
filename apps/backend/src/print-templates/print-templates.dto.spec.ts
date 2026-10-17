import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreatePrintTemplateDto, ResolvePrintTemplateQueryDto, UpsertPrintTemplateAssignmentDto } from './print-templates.dto';

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

    it('accepts a v3 config placing the title and bleeding the footer', async () => {
        expect(
            await parse({
                ...base,
                version: 3,
                logo: { heightMm: 16, showOnThermal: true, fullWidth: true },
                title: {
                    ...base.title,
                    position: 'above-center',
                    offsetXMm: -4,
                    offsetYMm: 2,
                },
                footer: { ...footer, pinToPageBottom: true, bleed: true },
            }),
        ).toHaveLength(0);
    });

    it('accepts a v4 config placing and sizing the QR code', async () => {
        expect(
            await parse({
                ...base,
                version: 4,
                qr: { sizeMm: 28, position: 'right-of-title', offsetXMm: -3, offsetYMm: 1.5 },
            }),
        ).toHaveLength(0);
    });

    describe('a paper designed separately (v5)', () => {
        /** Every failing property, as a dotted path from the template body. */
        const errorPaths = (errors: ValidationError[], prefix = ''): string[] =>
            errors.flatMap((error) => {
                const path = prefix ? `${prefix}.${error.property}` : error.property;
                return error.children?.length ? errorPaths(error.children, path) : [path];
            });
        const a5 = {
            ...base,
            version: 5,
            layout: 'text-only',
            company: { ...base.company, fontSizePt: 12 },
            lines: [{ text: 'A5 only' }],
            footer,
        };

        it('accepts a full design for A5 and Letter', async () => {
            const config = { ...base, version: 5, paperDesigns: { A5: a5, Letter: { ...a5, spacingMm: 6 } } };
            const dto = plainToInstance(CreatePrintTemplateDto, { name: 'Letterhead', config });

            expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
            // The whitelist must not strip the design on its way to the database.
            expect(JSON.parse(JSON.stringify(dto.config.paperDesigns))).toEqual(config.paperDesigns);
        });

        it('validates the paper\'s design as strictly as the main one', async () => {
            const unsafe = { ...a5, logo: { heightMm: 16, showOnThermal: true, url: 'javascript:alert(1)' } };

            const errors = await parse({ ...base, version: 5, paperDesigns: { A5: unsafe } });

            expect(errorPaths(errors)).toEqual(['config.paperDesigns.A5.logo.url']);
        });

        it('accepts a full design for each thermal roll', async () => {
            const config = { ...base, version: 5, paperDesigns: { Thermal80: a5, Thermal58: { ...a5, spacingMm: 2 } } };
            const dto = plainToInstance(CreatePrintTemplateDto, { name: 'Letterhead', config });

            expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
            expect(JSON.parse(JSON.stringify(dto.config.paperDesigns))).toEqual(config.paperDesigns);
        });

        it('validates a roll\'s design as strictly as the main one', async () => {
            const unsafe = { ...a5, logo: { heightMm: 16, showOnThermal: true, url: 'javascript:alert(1)' } };

            const errors = await parse({ ...base, version: 5, paperDesigns: { Thermal58: unsafe } });

            expect(errorPaths(errors)).toEqual(['config.paperDesigns.Thermal58.logo.url']);
        });

        it('rejects a design for a paper the editor cannot design', async () => {
            const errors = await parse({ ...base, version: 5, paperDesigns: { A4: a5 } });

            expect(errorPaths(errors)).toEqual(['config.paperDesigns.A4']);
        });
    });

    it('rejects a version the renderer does not know', async () => {
        expect((await parse({ ...base, version: 6 })).length).toBeGreaterThan(0);
    });

    it.each([
        ['a position outside the known slots', { sizeMm: 20, position: 'page-corner' }],
        ['a size too small to scan', { sizeMm: 4, position: 'below-title' }],
        ['a size larger than the band', { sizeMm: 200, position: 'below-title' }],
        ['a nudge off the page', { sizeMm: 20, position: 'below-title', offsetXMm: 500 }],
        ['a field the renderer does not read', { sizeMm: 20, position: 'below-title', style: 'x' }],
    ])('rejects a QR code with %s', async (_label, qr) => {
        expect((await parse({ ...base, version: 4, qr })).length).toBeGreaterThan(0);
    });

    it('rejects a title position outside the known slots', async () => {
        expect(
            (await parse({ ...base, title: { ...base.title, position: 'middle-middle' } })).length,
        ).toBeGreaterThan(0);
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

    describe('document type assignment', () => {
        const parseDocTypes = (doc_types: string[]) =>
            validate(
                plainToInstance(CreatePrintTemplateDto, { name: 'Letterhead', doc_types, config: base }),
                { whitelist: true, forbidNonWhitelisted: true },
            );

        /*
         * The boundary a tenant actually hits: assigning a letterhead to the
         * delivery challan in Settings → Print Templates. Drop the enum member
         * and this save starts 400ing.
         */
        it('accepts a template assigned to the delivery challan', async () => {
            expect(await parseDocTypes(['DELIVERY_CHALLAN'])).toHaveLength(0);
        });

        it('accepts the challan alongside the invoice on one template', async () => {
            expect(await parseDocTypes(['SALES_INVOICE', 'DELIVERY_CHALLAN'])).toHaveLength(0);
        });

        it('rejects a document type the renderer has no printer for', async () => {
            expect((await parseDocTypes(['DELIVERY_NOTE'])).length).toBeGreaterThan(0);
        });

        it('accepts a template assigned to the purchase invoice', async () => {
            expect(await parseDocTypes(['PURCHASE_INVOICE'])).toHaveLength(0);
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

describe('UpsertPrintTemplateAssignmentDto', () => {
    const parse = (body: Record<string, unknown>) =>
        validate(plainToInstance(UpsertPrintTemplateAssignmentDto, body), {
            whitelist: true,
            forbidNonWhitelisted: true,
        });

    const uuid = '11111111-1111-4111-8111-111111111111';
    const tpl = '22222222-2222-4222-8222-222222222222';

    it('accepts a pin to a named template', async () => {
        expect(await parse({ storeId: uuid, docType: 'SALES_INVOICE', templateId: tpl })).toHaveLength(0);
    });

    it('accepts templateId null to follow company paper', async () => {
        expect(await parse({ storeId: uuid, docType: 'SALES_INVOICE', templateId: null })).toHaveLength(0);
    });

    it('rejects an unknown property', async () => {
        expect(
            (await parse({ storeId: uuid, docType: 'SALES_INVOICE', templateId: tpl, extra: true })).length,
        ).toBeGreaterThan(0);
    });

    it('rejects a document type the printer has no family for', async () => {
        expect(
            (await parse({ storeId: uuid, docType: 'DELIVERY_NOTE', templateId: tpl })).length,
        ).toBeGreaterThan(0);
    });

    it('rejects a templateId that is neither a UUID nor null', async () => {
        expect(
            (await parse({ storeId: uuid, docType: 'SALES_INVOICE', templateId: 'nope' })).length,
        ).toBeGreaterThan(0);
    });

    it('rejects a missing templateId', async () => {
        expect((await parse({ storeId: uuid, docType: 'SALES_INVOICE' })).length).toBeGreaterThan(0);
    });
});

describe('ResolvePrintTemplateQueryDto', () => {
    it('accepts an optional storeId', async () => {
        const errors = await validate(
            plainToInstance(ResolvePrintTemplateQueryDto, {
                docType: 'SALES_INVOICE',
                storeId: '11111111-1111-4111-8111-111111111111',
            }),
            { whitelist: true, forbidNonWhitelisted: true },
        );
        expect(errors).toHaveLength(0);
    });
});
