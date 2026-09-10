import { fillTemplate, TEMPLATE_TOKENS } from './crm-message-templates';

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
