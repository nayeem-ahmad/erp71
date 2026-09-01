/**
 * BillingEvent types written by the reminder cycle, not financial transactions.
 * These are kept in the DB (the scheduler relies on them for dedup/email) but are
 * excluded from the tenant ledger and surfaced on a dedicated reminders view.
 * SUBSCRIPTION_GOOD_STANDING is the positive note sent when nothing is due.
 */
export const REMINDER_EVENT_TYPES = [
    'PAYMENT_RETRY_REMINDER',
    'ADDON_PAYMENT_RETRY_REMINDER',
    'SUBSCRIPTION_GOOD_STANDING',
] as const;
