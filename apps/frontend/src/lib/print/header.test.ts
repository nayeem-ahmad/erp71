import {
    applyTokens,
    headerConfigFromBranding,
    headerCss,
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
