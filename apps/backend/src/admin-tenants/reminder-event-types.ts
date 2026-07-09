/**
 * BillingEvent types that are payment reminders, not financial transactions.
 * These are kept in the DB (the scheduler relies on them for dedup/email) but are
 * excluded from the tenant ledger and surfaced on a dedicated reminders view.
 */
export const REMINDER_EVENT_TYPES = ['PAYMENT_RETRY_REMINDER', 'ADDON_PAYMENT_RETRY_REMINDER'] as const;
