/**
 * Approved Meta template `erp71_customer_update` (English).
 * Body: Hello {{1}}, this is a message from ERP71. {{2}} Thank you for shopping with us.
 * {{1}} is the customer name. {{2}} is the campaign text.
 */
export const CUSTOMER_UPDATE_TEMPLATE = {
    name: 'erp71_customer_update',
    language: 'en',
} as const;

/**
 * Meta rejects a template parameter that is empty, or that contains a newline,
 * a tab, or more than four spaces in a row.
 */
export function templateParameter(value: string | null | undefined, fallback: string): string {
    const flat = (value ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/ {5,}/g, '    ')
        .trim();
    const text = flat.length > 0 ? flat : fallback;
    return text.slice(0, 1024);
}

export function customerUpdatePayload(to: string, name: string | null | undefined, message: string) {
    return {
        messaging_product: 'whatsapp',
        to,
        type: 'template' as const,
        template: {
            name: CUSTOMER_UPDATE_TEMPLATE.name,
            language: { code: CUSTOMER_UPDATE_TEMPLATE.language },
            components: [
                {
                    type: 'body' as const,
                    parameters: [
                        { type: 'text' as const, text: templateParameter(name, 'Customer') },
                        { type: 'text' as const, text: templateParameter(message, 'We have an update for you.') },
                    ],
                },
            ],
        },
    };
}
