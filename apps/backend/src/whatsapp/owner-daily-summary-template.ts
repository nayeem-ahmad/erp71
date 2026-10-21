import { templateParameter } from './customer-update-template';

/**
 * Meta template `erp71_tenant_owner_daily_summary` (English). In review as of
 * 2026-10-22. Body:
 * Hello {{1}},
 * Here is the daily summary for {{2}}
 * {{3}}
 * -
 * Thanks for using ERP71
 * {{1}} is the person's name. {{2}} is the shop day. {{3}} is the summary.
 */
export const OWNER_DAILY_SUMMARY_TEMPLATE = {
    name: 'erp71_tenant_owner_daily_summary',
    language: 'en',
} as const;

export function ownerDailySummaryPayload(
    to: string,
    name: string | null | undefined,
    day: string,
    summary: string,
) {
    return {
        messaging_product: 'whatsapp',
        to,
        type: 'template' as const,
        template: {
            name: OWNER_DAILY_SUMMARY_TEMPLATE.name,
            language: { code: OWNER_DAILY_SUMMARY_TEMPLATE.language },
            components: [
                {
                    type: 'body' as const,
                    parameters: [
                        { type: 'text' as const, text: templateParameter(name, 'there') },
                        { type: 'text' as const, text: templateParameter(day, 'today') },
                        { type: 'text' as const, text: templateParameter(summary, 'No sales.') },
                    ],
                },
            ],
        },
    };
}
