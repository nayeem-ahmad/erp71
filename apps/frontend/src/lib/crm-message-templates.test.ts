import { fillTemplate, TEMPLATE_TOKENS, unknownTemplateTokens } from './crm-message-templates';

describe('fillTemplate', () => {
    const vars = {
        name: 'Karim Traders',
        phone: '01700000000',
        user: 'Nayeem',
        business: 'Dhaka Electronics',
        date: '10/09/2026',
    };

    it('substitutes every documented token', () => {
        const body = TEMPLATE_TOKENS.map((token) => `{{${token}}}`).join(' ');

        expect(fillTemplate(body, vars)).toBe(
            'Karim Traders 01700000000 Nayeem Dhaka Electronics 10/09/2026',
        );
    });

    it('tolerates the spacing and casing people actually type', () => {
        expect(fillTemplate('Dear {{ Name }},', vars)).toBe('Dear Karim Traders,');
    });

    /**
     * The whole point of leaving it standing: "Dear {{name}}" in the box is a
     * prompt to finish the sentence, "Dear ," is a message that goes out broken.
     */
    it('leaves a token with no value to fill it exactly as written', () => {
        expect(fillTemplate('Dear {{name}}, call {{user}}.', { user: 'Nayeem' })).toBe(
            'Dear {{name}}, call Nayeem.',
        );
    });

    it('leaves a token nobody defined alone', () => {
        expect(fillTemplate('Ref {{invoice}}', vars)).toBe('Ref {{invoice}}');
    });

    it('replaces every occurrence, not just the first', () => {
        expect(fillTemplate('{{name}} — {{name}}', vars)).toBe('Karim Traders — Karim Traders');
    });

    it('returns text with no placeholders untouched', () => {
        expect(fillTemplate('Called about the invoice.', vars)).toBe('Called about the invoice.');
    });
});

describe('unknownTemplateTokens', () => {
    it('finds nothing in a template that uses only the documented tokens', () => {
        const body = TEMPLATE_TOKENS.map((token) => `{{${token}}}`).join(' ');

        expect(unknownTemplateTokens(body)).toEqual([]);
    });

    /** Whatever `fillTemplate` accepts, this must not flag — or the warning lies. */
    it('accepts the spacing and casing fillTemplate tolerates', () => {
        expect(unknownTemplateTokens('Dear {{ Name }}, from {{USER}}')).toEqual([]);
    });

    it('flags a misspelt token exactly as it was typed', () => {
        expect(unknownTemplateTokens('Dear {{nmae}}, call {{ Phnoe }}.')).toEqual([
            '{{nmae}}',
            '{{ Phnoe }}',
        ]);
    });

    /** `fillTemplate` only reads one word between the braces, so these stand too. */
    it('flags tokens fillTemplate cannot read at all', () => {
        expect(unknownTemplateTokens('{{first name}} {{}}')).toEqual(['{{first name}}', '{{}}']);
    });

    it('lists a repeated mistake once', () => {
        expect(unknownTemplateTokens('{{nmae}} and {{nmae}}')).toEqual(['{{nmae}}']);
    });

    /** Literal braces are a tenant's business — only the double-brace form is a placeholder. */
    it('leaves single braces and plain text alone', () => {
        expect(unknownTemplateTokens('Price {500} — call us.')).toEqual([]);
    });
});
