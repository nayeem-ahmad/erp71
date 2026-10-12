/**
 * The kinds of notification a person can choose to keep off their phone,
 * with how the settings screen describes each. Every one stays in the bell.
 */
export const ALERT_TYPES = [
    { type: 'APPROVAL_REQUEST', label: 'Approvals waiting', description: 'Expense claims, leave, product demands and stock transfers that need you.' },
    { type: 'TILL_SHORTFALL', label: 'Short tills', description: 'A till closed short by more than the shop’s line.' },
    { type: 'LARGE_SALE', label: 'Large sales', description: 'A sale at or above the shop’s line.' },
    { type: 'LARGE_REFUND', label: 'Large refunds', description: 'A refund at or above the shop’s line.' },
    { type: 'SALE_VOIDED', label: 'Cancelled sales', description: 'Any completed sale that is cancelled.' },
    { type: 'ENQUIRY', label: 'Website enquiries', description: 'Someone wrote in from your storefront.' },
    { type: 'ANOMALY_DIGEST', label: 'Daily anomaly check', description: 'At 20:30, anything unusual in the day’s sales and purchases.' },
    { type: 'LOW_STOCK', label: 'Low stock', description: 'Products at or below their reorder level, once a day.' },
] as const;

export const ALERT_TYPE_CODES: readonly string[] = ALERT_TYPES.map((t) => t.type);
