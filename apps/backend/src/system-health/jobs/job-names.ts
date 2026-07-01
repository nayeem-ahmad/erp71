/**
 * Stable identifiers and metadata for every tracked scheduled job. Used by the
 * job tracker (to record runs) and the cron health check (to detect overdue
 * jobs). Keep `name` values stable — they are persisted in the JobRun table.
 */
export const JOB_NAMES = {
    BILLING_RETRY: 'billing.retry-failed-payments',
    BILLING_DUNNING: 'billing.dunning',
    NOTIFICATIONS_EXPIRY_WARNINGS: 'notifications.subscription-expiry-warnings',
    NOTIFICATIONS_LOW_STOCK: 'notifications.low-stock-alerts',
    NOTIFICATIONS_WEEKLY: 'notifications.weekly-reports',
    NOTIFICATIONS_MONTHLY: 'notifications.monthly-reports',
    NOTIFICATIONS_PURGE: 'notifications.purge-expired',
    CRM_CAMPAIGNS: 'crm.process-scheduled-campaigns',
    CRM_REORDER_TASKS: 'crm.reorder-reminder-tasks',
    CRM_BIRTHDAY_TASKS: 'crm.birthday-tasks',
    CUSTOMER_SEGMENTS: 'customers.recalculate-segments',
    HEALTH_ALERTS: 'system-health.evaluate-alerts',
    ACCOUNTING_RECURRING_VOUCHERS: 'accounting.post-due-recurring-vouchers',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface JobDefinition {
    name: JobName;
    label: string;
    /** Cron expression, shown in the dashboard for context. */
    schedule: string;
    /**
     * A successful run is expected at least this often. If the newest success
     * is older than this, the job is flagged overdue. Includes generous slack
     * over the nominal cadence so a slightly late run isn't a false alarm.
     */
    maxIntervalMs: number;
}

/** Every scheduled job we expect to run, with its overdue threshold. */
export const JOB_REGISTRY: JobDefinition[] = [
    { name: JOB_NAMES.BILLING_RETRY, label: 'Billing: retry failed payments', schedule: '0 8 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.BILLING_DUNNING, label: 'Billing: dunning', schedule: '0 9 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_EXPIRY_WARNINGS, label: 'Notifications: subscription expiry warnings', schedule: '0 8 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_LOW_STOCK, label: 'Notifications: low stock alerts', schedule: '0 7 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_WEEKLY, label: 'Notifications: weekly reports', schedule: '0 7 * * 1', maxIntervalMs: 7 * DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_MONTHLY, label: 'Notifications: monthly reports', schedule: '0 7 1 * *', maxIntervalMs: 31 * DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_PURGE, label: 'Notifications: purge expired data', schedule: '0 3 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.CRM_CAMPAIGNS, label: 'CRM: process scheduled campaigns', schedule: '*/5 * * * *', maxIntervalMs: 15 * 60 * 1000 },
    { name: JOB_NAMES.CRM_REORDER_TASKS, label: 'CRM: reorder reminder tasks', schedule: '0 8 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.CRM_BIRTHDAY_TASKS, label: 'CRM: birthday tasks', schedule: '0 8 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.CUSTOMER_SEGMENTS, label: 'Customers: recalculate segments', schedule: '0 0 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.HEALTH_ALERTS, label: 'System health: evaluate alerts', schedule: '*/5 * * * *', maxIntervalMs: 15 * 60 * 1000 },
    { name: JOB_NAMES.ACCOUNTING_RECURRING_VOUCHERS, label: 'Accounting: post due recurring vouchers', schedule: '0 6 * * *', maxIntervalMs: DAY + 2 * HOUR },
];
