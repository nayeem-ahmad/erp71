import { ownerDailySummaryPayload } from './owner-daily-summary-template';

describe('owner daily summary WhatsApp template', () => {
    it('fills the English owner template', () => {
        expect(ownerDailySummaryPayload('8801711111111', 'Karim', '20 Oct', 'Sales Tk1,500.')).toEqual({
            messaging_product: 'whatsapp',
            to: '8801711111111',
            type: 'template',
            template: {
                name: 'erp71_tenant_owner_daily_summary',
                language: { code: 'en' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: 'Karim' },
                            { type: 'text', text: '20 Oct' },
                            { type: 'text', text: 'Sales Tk1,500.' },
                        ],
                    },
                ],
            },
        });
    });

    it('flattens a summary Meta would reject and fills an empty name', () => {
        const body = ownerDailySummaryPayload('8801711111111', '  ', '20 Oct', 'Sales\nCash     moved');
        expect(body.template.components[0].parameters.map((parameter) => parameter.text)).toEqual([
            'there',
            '20 Oct',
            'Sales Cash    moved',
        ]);
    });
});
