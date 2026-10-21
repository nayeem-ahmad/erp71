import { customerUpdatePayload, templateParameter } from './customer-update-template';

describe('customer update WhatsApp template', () => {
    it('puts the name and the message in the approved template', () => {
        expect(customerUpdatePayload('8801714111977', 'Rahim', 'Your order is ready.')).toEqual({
            messaging_product: 'whatsapp',
            to: '8801714111977',
            type: 'template',
            template: {
                name: 'erp71_customer_update',
                language: { code: 'en' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: 'Rahim' },
                            { type: 'text', text: 'Your order is ready.' },
                        ],
                    },
                ],
            },
        });
    });

    it('fills a missing name and flattens a message Meta would reject', () => {
        expect(templateParameter('  ', 'Customer')).toBe('Customer');
        expect(templateParameter('Line one\n\tLine two     more', 'fallback')).toBe('Line one Line two    more');
    });

    it('uses a fallback sentence when the campaign text is blank', () => {
        const body = customerUpdatePayload('8801714111977', null, '   ');
        expect(body.template.components[0].parameters.map((p) => p.text)).toEqual([
            'Customer',
            'We have an update for you.',
        ]);
    });
});
