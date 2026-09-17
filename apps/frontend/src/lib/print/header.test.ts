import {
    applyTokens,
    footerBleeds,
    footerPinsToBottom,
    footerRepeats,
    hasFooter,
    headerConfigFromBranding,
    headerCss,
    renderFooterHtml,
    renderHeaderHtml,
    resolveHeaderConfig,
} from './header';
import type { HeaderContext, PrintHeaderConfig, DeepPartial } from './types';

const ctx: HeaderContext = {
    docTitle: 'Invoice',
    docNumber: 'INV-001',
    docDate: '31 Jul 2026',
    companyName: 'Rahim Traders',
    address: '12 Motijheel, Dhaka',
    phone: '01711-000000',
    vatRegNo: '00123456789',
};

describe('applyTokens', () => {
    it('substitutes known tokens and ignores case/whitespace', () => {
        expect(applyTokens('{{company_name}} — {{ PHONE }}', ctx)).toEqual({
            text: 'Rahim Traders — 01711-000000',
            empty: false,
        });
    });

    it('marks a line empty when every token in it resolves empty', () => {
        expect(applyTokens('Tel: {{phone}}', { ...ctx, phone: undefined }).empty).toBe(true);
    });

    it('keeps a line whose tokens are only partly empty', () => {
        const result = applyTokens('{{company_name}} {{email}}', ctx);
        expect(result.empty).toBe(false);
        expect(result.text).toBe('Rahim Traders');
    });

    it('treats unknown tokens as empty', () => {
        expect(applyTokens('{{not_a_token}}', ctx).empty).toBe(true);
    });

    it('keeps static text that contains no tokens', () => {
        expect(applyTokens('Thank you', ctx)).toEqual({ text: 'Thank you', empty: false });
    });
});

describe('renderHeaderHtml', () => {
    it('renders company name, tokenised lines and the document block', () => {
        const html = renderHeaderHtml(undefined, ctx, 'A4');

        expect(html).toContain('Rahim Traders');
        expect(html).toContain('12 Motijheel, Dhaka');
        expect(html).toContain('Tel: 01711-000000');
        expect(html).toContain('Invoice');
        expect(html).toContain('# INV-001');
        expect(html).toContain('31 Jul 2026');
    });

    it('drops a line whose tokens have no values', () => {
        const html = renderHeaderHtml(undefined, { ...ctx, phone: undefined }, 'A4');
        expect(html).not.toContain('Tel:');
    });

    it('escapes tenant-supplied text', () => {
        const html = renderHeaderHtml(undefined, { ...ctx, companyName: '<script>x</script>' }, 'A4');

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('renders the logo when one is configured', () => {
        const html = renderHeaderHtml(
            { logo: { url: 'https://cdn.example.com/logo.png' } },
            ctx,
            'A4',
        );
        expect(html).toContain('src="https://cdn.example.com/logo.png"');
    });

    it('refuses a javascript: logo url', () => {
        const html = renderHeaderHtml(
            { logo: { url: 'javascript:alert(1)' } },
            ctx,
            'A4',
        );
        expect(html).not.toContain('javascript:');
    });

    it('honours nameOverride over the document context', () => {
        const html = renderHeaderHtml({ company: { nameOverride: 'Rahim Traders Ltd.' } }, ctx, 'A4');

        expect(html).toContain('Rahim Traders Ltd.');
        expect(html).not.toContain('>Rahim Traders<');
    });

    it('returns an empty string when there is nothing to render', () => {
        const config: DeepPartial<PrintHeaderConfig> = {
            company: { show: false },
            title: { show: false },
            lines: [],
        };
        expect(renderHeaderHtml(config, {}, 'A4')).toBe('');
    });

    it('omits the logo on thermal paper when showOnThermal is off', () => {
        const config: DeepPartial<PrintHeaderConfig> = {
            logo: { url: 'https://cdn.example.com/logo.png', showOnThermal: false },
        };

        expect(renderHeaderHtml(config, ctx, 'Thermal58')).not.toContain('logo.png');
        expect(renderHeaderHtml(config, ctx, 'A4')).toContain('logo.png');
    });
});

describe('resolveHeaderConfig', () => {
    it('applies per-paper overrides over the base config', () => {
        const resolved = resolveHeaderConfig(
            { company: { fontSizePt: 18 }, perPaper: { A5: { company: { fontSizePt: 12 } } } },
            'A5',
        );
        expect(resolved.company.fontSizePt).toBe(12);
    });

    it('coerces side-by-side layouts and oversized type on thermal rolls', () => {
        const resolved = resolveHeaderConfig(
            { layout: 'logo-left', company: { fontSizePt: 24 }, logo: { heightMm: 40 } },
            'Thermal58',
        );

        expect(resolved.layout).toBe('logo-above');
        expect(resolved.company.fontSizePt).toBe(12);
        expect(resolved.logo.heightMm).toBe(10);
    });

    it('leaves full-page sizes untouched', () => {
        const resolved = resolveHeaderConfig({ layout: 'logo-left', company: { fontSizePt: 24 } }, 'A4');

        expect(resolved.layout).toBe('logo-left');
        expect(resolved.company.fontSizePt).toBe(24);
    });
});

describe('headerCss', () => {
    it('emits the configured accent colour', () => {
        expect(headerCss({ company: { color: '#0f766e' } }, 'A4')).toContain('#0f766e');
    });

    it('falls back to the default when the colour is not a hex value', () => {
        const css = headerCss({ company: { color: 'red; background:url(x)' } }, 'A4');

        expect(css).not.toContain('url(x)');
        expect(css).toContain('#1d4ed8');
    });

    it('drops the rule when it is switched off', () => {
        expect(headerCss({ rule: { show: false } }, 'A4')).not.toContain('border-bottom:');
    });
});

describe('headerConfigFromBranding', () => {
    it('maps the tenant logo and primary colour into a header config', () => {
        const config = headerConfigFromBranding({
            logoUrl: 'https://cdn.example.com/logo.png',
            primaryColor: '#0f766e',
        });

        expect(config.logo?.url).toBe('https://cdn.example.com/logo.png');
        expect(config.company?.color).toBe('#0f766e');
        expect(config.title?.color).toBe('#0f766e');
    });

    it('ignores an invalid primary colour', () => {
        expect(headerConfigFromBranding({ primaryColor: 'teal' }).company?.color).toBe('#1d4ed8');
    });
});

/* ------------------------------------------------------------------ */
/*  Letterhead footer                                                  */
/* ------------------------------------------------------------------ */

/** A config with the footer switched on and one static line. */
const withFooter = (
    footer: DeepPartial<PrintHeaderConfig['footer']> = {},
): DeepPartial<PrintHeaderConfig> => ({
    footer: {
        show: true,
        lines: [{ text: 'Bank: BRAC 1234', fontSizePt: 9 }],
        ...footer,
    },
});

describe('renderFooterHtml', () => {
    it('renders nothing for a stored v1 config that has no footer at all', () => {
        expect(renderFooterHtml({ version: 1, lines: [] }, ctx, 'A4')).toBe('');
    });

    it('renders nothing while the footer is switched off', () => {
        expect(renderFooterHtml({ footer: { show: false } }, ctx, 'A4')).toBe('');
    });

    it('renders the footer lines once switched on', () => {
        const html = renderFooterHtml(withFooter(), ctx, 'A4');

        expect(html).toContain('p71-ft');
        expect(html).toContain('Bank: BRAC 1234');
    });

    it('substitutes tokens in footer lines', () => {
        const html = renderFooterHtml(withFooter({ lines: [{ text: 'Tel: {{phone}}' }] }), ctx, 'A4');

        expect(html).toContain('Tel: 01711-000000');
    });

    it('drops a footer line whose tokens all resolve empty', () => {
        const config = withFooter({ lines: [{ text: 'Tel: {{phone}}' }] });

        expect(renderFooterHtml(config, { ...ctx, phone: undefined }, 'A4')).toBe('');
    });

    it('escapes markup a tenant types into a footer line', () => {
        const config = withFooter({ lines: [{ text: '<script>alert(1)</script>' }] });

        expect(renderFooterHtml(config, ctx, 'A4')).not.toContain('<script>');
    });

    it('renders an empty string when the footer is on but carries no content', () => {
        expect(renderFooterHtml(withFooter({ lines: [], images: [] }), ctx, 'A4')).toBe('');
    });
});

describe('footerRepeats', () => {
    it('is off unless the tenant asked for it', () => {
        expect(footerRepeats(withFooter(), 'A4')).toBe(false);
        expect(footerRepeats(withFooter({ repeatOnEveryPage: true }), 'A4')).toBe(true);
    });

    it('is forced off on thermal rolls, which have no page bottom', () => {
        expect(footerRepeats(withFooter({ repeatOnEveryPage: true }), 'Thermal80')).toBe(false);
    });
});

describe('hasFooter', () => {
    it('reports whether a tenant footer would print', () => {
        expect(hasFooter(undefined, ctx, 'A4')).toBe(false);
        expect(hasFooter(withFooter(), ctx, 'A4')).toBe(true);
    });
});

/* ------------------------------------------------------------------ */
/*  Letterhead images                                                  */
/* ------------------------------------------------------------------ */

describe('template images', () => {
    const signature = { url: 'https://cdn.example.com/sign.png', heightMm: 14, align: 'right' as const };

    it('renders a header image into its alignment bucket', () => {
        const html = renderHeaderHtml({ images: [signature] }, ctx, 'A4');

        expect(html).toContain('p71-hd-images');
        expect(html).toContain('p71-img-col--right');
        expect(html).toContain('https://cdn.example.com/sign.png');
    });

    it('renders footer images alongside the footer text', () => {
        const html = renderFooterHtml(withFooter({ images: [signature] }), ctx, 'A4');

        expect(html).toContain('p71-ft-images');
        expect(html).toContain('https://cdn.example.com/sign.png');
    });

    it('rejects a javascript: image URL', () => {
        const html = renderHeaderHtml(
            // eslint-disable-next-line no-script-url
            { images: [{ url: 'javascript:alert(1)', heightMm: 10, caption: 'Seal' }] },
            ctx,
            'A4',
        );

        expect(html).not.toContain('javascript:');
        // The caption still prints — that is the blank signature-line case.
        expect(html).toContain('Seal');
    });

    it('prints a blank signature line for a caption with no image', () => {
        const html = renderFooterHtml(
            withFooter({ images: [{ heightMm: 12, caption: 'Authorised Signature' }] }),
            ctx,
            'A4',
        );

        expect(html).toContain('Authorised Signature');
        expect(html).not.toContain('<img');
    });

    it('escapes a caption containing markup', () => {
        const html = renderFooterHtml(
            withFooter({ images: [{ heightMm: 12, caption: '<b>x</b>' }] }),
            ctx,
            'A4',
        );

        expect(html).not.toContain('<b>');
    });

    it('drops an entry that has neither a usable image nor a caption', () => {
        expect(renderHeaderHtml({ images: [{ heightMm: 12 }] }, ctx, 'A4')).not.toContain('p71-hd-images');
    });

    it('hides images on thermal rolls unless they opt in', () => {
        const off = renderFooterHtml(withFooter({ images: [signature] }), ctx, 'Thermal80');
        const on = renderFooterHtml(
            withFooter({ images: [{ ...signature, showOnThermal: true }] }),
            ctx,
            'Thermal80',
        );

        expect(off).not.toContain('p71-ft-images');
        expect(on).toContain('p71-ft-images');
    });

    it('clamps an out-of-range image height', () => {
        const html = renderHeaderHtml({ images: [{ ...signature, heightMm: 9999 }] }, ctx, 'A4');

        expect(html).toContain('height:60mm');
    });

    it('moves the divider onto the wrapper so it is emitted exactly once', () => {
        const css = headerCss({ images: [signature] }, 'A4');

        expect(css).toContain('.p71-hd-wrap');
        expect(css.match(/border-bottom:/g)).toHaveLength(1);
    });
});

/* ------------------------------------------------------------------ */
/*  Line formatting                                                    */
/* ------------------------------------------------------------------ */

describe('line formatting', () => {
    // Deliberately untyped: several cases feed values the type forbids, to prove
    // the renderer sanitises rather than trusting them.
    const render = (line: Record<string, unknown>) =>
        renderHeaderHtml({ lines: [line] } as DeepPartial<PrintHeaderConfig>, ctx, 'A4');

    it('applies underline, letter spacing and a per-line font', () => {
        const html = render({ text: 'Terms apply', underline: true, letterSpacingPx: 3, fontFamily: 'serif' });

        expect(html).toContain('text-decoration:underline');
        expect(html).toContain('letter-spacing:3px');
        expect(html).toContain('Georgia');
    });

    it('falls back to the template font for an unknown per-line font', () => {
        const html = render({ text: 'Terms apply', fontFamily: 'comic-sans' });

        expect(html).toContain('Arial');
        expect(html).not.toContain('comic-sans');
    });

    it('clamps letter spacing to the supported range', () => {
        expect(render({ text: 'x', letterSpacingPx: 999 })).toContain('letter-spacing:10px');
    });

    it('rejects an alignment that is not one of the three keywords', () => {
        const html = render({ text: 'x', align: 'left;position:fixed' });

        expect(html).not.toContain('position:fixed');
        expect(html).toContain('text-align:left');
    });
});

describe('logo width', () => {
    const withLogo = (logo: Record<string, unknown>) =>
        renderHeaderHtml({ logo: { url: 'https://cdn.example.com/logo.png', ...logo } } as DeepPartial<PrintHeaderConfig>, ctx, 'A4');

    it('prints at its natural width when no cap is set', () => {
        const html = withLogo({ heightMm: 16 });

        expect(html).toContain('height:16mm');
        expect(html).not.toContain('max-width:');
    });

    it('caps the width only when the tenant asks for a cap', () => {
        expect(withLogo({ heightMm: 16, maxWidthMm: 40 })).toContain('max-width:40mm');
    });

    it('clamps an out-of-range cap rather than emitting it raw', () => {
        expect(withLogo({ heightMm: 16, maxWidthMm: 9999 })).toContain('max-width:250mm');
    });

    it('drops the height when the logo is sized by width', () => {
        const html = withLogo({ heightMm: 16, fullWidth: true });

        expect(html).toContain('p71-hd-logo--full');
        expect(html).not.toContain('height:16mm');
    });

    it('no longer caps the stylesheet default at 60mm', () => {
        expect(headerCss({}, 'A4')).not.toContain('max-width: 60mm');
    });
});

describe('title position', () => {
    const render = (config: DeepPartial<PrintHeaderConfig>) => renderHeaderHtml(config, ctx, 'A4');

    it('keeps a stored config printing where it always did', () => {
        // No `position`: logo-left put the title beside the brand, on the right.
        expect(render({ layout: 'logo-left' })).toContain('p71-hd-doc--beside p71-hd-doc--right');
        expect(render({ layout: 'logo-right' })).toContain('p71-hd-doc--beside p71-hd-doc--left');
        expect(render({ layout: 'logo-above' })).toContain('p71-hd-doc--below p71-hd-doc--center');
    });

    it('lifts the title out of the band into a row of its own', () => {
        const html = render({ layout: 'logo-left', title: { position: 'above-center' } });
        const bandStart = html.indexOf('class="p71-hd p71-hd--logo-left"');
        const titleStart = html.indexOf('p71-hd-doc--above');

        expect(titleStart).toBeGreaterThanOrEqual(0);
        expect(titleStart).toBeLessThan(bandStart);
    });

    it('puts a below-positioned title after the band', () => {
        const html = render({ layout: 'logo-left', title: { position: 'below-right' } });

        expect(html.indexOf('p71-hd-doc--below')).toBeGreaterThan(html.indexOf('p71-hd--logo-left'));
    });

    it('applies a nudge as a relative offset so the title stays in the flow', () => {
        const html = render({ title: { position: 'above-center', offsetXMm: -6, offsetYMm: 3 } });

        expect(html).toContain('left:-6mm;top:3mm');
        expect(headerCss({ title: { position: 'above-center' } }, 'A4')).toContain('position: relative');
    });

    it('omits the offset style when there is no nudge', () => {
        expect(render({ title: { position: 'above-center' } })).not.toContain('left:0mm');
    });

    it('clamps a nudge far beyond the page', () => {
        expect(render({ title: { offsetXMm: 9999, offsetYMm: -9999 } })).toContain('left:100mm;top:-100mm');
    });

    it('ignores a position that is not one of the known slots', () => {
        const html = render({
            layout: 'logo-left',
            title: { position: 'center;position:fixed' as never },
        });

        expect(html).not.toContain('position:fixed');
        expect(html).toContain('p71-hd-doc--beside p71-hd-doc--right');
    });

    it('centres the title on a thermal roll, which has no room for slots', () => {
        const html = renderHeaderHtml({ title: { position: 'beside-right', offsetXMm: 20 } }, ctx, 'Thermal58');

        expect(html).toContain('p71-hd-doc--below p71-hd-doc--center');
        expect(html).not.toContain('left:20mm');
    });
});

describe('footer bleed and pinning', () => {
    const footerBase = {
        show: true,
        lines: [{ text: 'Bank: Sonali 123' }],
        images: [{ url: 'https://cdn.example.com/strip.png', heightMm: 12, fullWidth: true }],
        rule: { show: true, thicknessPx: 1, color: '#d1d5db' },
        spacingMm: 4,
        repeatOnEveryPage: true,
    };

    it('renders a full-width footer image in a row of its own', () => {
        const html = renderFooterHtml({ footer: footerBase } as DeepPartial<PrintHeaderConfig>, ctx, 'A4');

        expect(html).toContain('p71-ft-images--full');
        expect(html).toContain('p71-img-el--full');
        // Sized by width, so no height is pinned onto the image.
        expect(html).not.toContain('height:12mm');
    });

    it('cancels the page margin when the footer bleeds', () => {
        const css = headerCss({ footer: { ...footerBase, bleed: true } } as DeepPartial<PrintHeaderConfig>, 'A4');

        expect(css).toContain('margin-left: -15mm');
        expect(css).toContain('margin-right: -15mm');
        // No explicit width: a box wider than its wrapper is cropped at both
        // edges instead of bleeding. Negative margins alone do the job.
        expect(css).not.toContain('width: calc(');
    });

    it('keeps footer text inside the margin even while the band bleeds', () => {
        const css = headerCss({ footer: { ...footerBase, bleed: true } } as DeepPartial<PrintHeaderConfig>, 'A4');

        expect(css).toContain('.p71-ft-line { padding-left: 15mm; padding-right: 15mm; }');
        expect(css).toContain('.p71-ft .p71-ft-images--full { padding-left: 0; padding-right: 0; }');
    });

    it('uses the paper size\'s own margin', () => {
        expect(headerCss({ footer: { ...footerBase, bleed: true } } as DeepPartial<PrintHeaderConfig>, 'A5'))
            .toContain('margin-left: -10mm');
    });

    it('emits no bleed rules when the footer does not bleed', () => {
        expect(headerCss({ footer: footerBase } as DeepPartial<PrintHeaderConfig>, 'A4')).not.toContain('margin-left: -');
    });

    it('pins only a repeating footer — there is no tfoot to pin otherwise', () => {
        const config = { footer: { ...footerBase, pinToPageBottom: true } } as DeepPartial<PrintHeaderConfig>;

        expect(footerPinsToBottom(config, 'A4')).toBe(true);
        expect(footerPinsToBottom(
            { footer: { ...footerBase, pinToPageBottom: true, repeatOnEveryPage: false } } as DeepPartial<PrintHeaderConfig>,
            'A4',
        )).toBe(false);
    });

    it('never pins or bleeds on a roll, which has no page bottom or margin', () => {
        const config = { footer: { ...footerBase, pinToPageBottom: true, bleed: true } } as DeepPartial<PrintHeaderConfig>;

        expect(footerPinsToBottom(config, 'Thermal80')).toBe(false);
        expect(footerBleeds(config, 'Thermal80')).toBe(false);
    });
});
