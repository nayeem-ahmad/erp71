import {
    applyTokens,
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
