/**
 * Stable identifiers and metadata for every tracked scheduled job. Used by the
 * job tracker (to record runs) and the cron health check (to detect overdue
 * jobs). Keep `name` values stable — they are persisted in the JobRun table.
 */
export const JOB_NAMES = {
    BILLING_RETRY: 'billing.retry-failed-payments',
    BILLING_DUNNING: 'billing.dunning',
    BILLING_PERIOD_FEES: 'billing.post-subscription-period-fees',
    NOTIFICATIONS_EXPIRY_WARNINGS: 'notifications.subscription-expiry-warnings',
    NOTIFICATIONS_LOW_STOCK: 'notifications.low-stock-alerts',
    NOTIFICATIONS_WEEKLY: 'notifications.weekly-reports',
    NOTIFICATIONS_MONTHLY: 'notifications.monthly-reports',
    NOTIFICATIONS_PURGE: 'notifications.purge-expired',
    CRM_CAMPAIGNS: 'crm.process-scheduled-campaigns',
    // The persisted string values below are kept as -tasks per the note above,
    // even though the feature (CrmTask) was renamed to CrmFollowUp everywhere
    // else — "Task" was freed up for the upcoming Project Management module.
    // Only the constant key changed, so JobRun history stays queryable.
    CRM_REORDER_FOLLOWUPS: 'crm.reorder-reminder-tasks',
    CRM_BIRTHDAY_FOLLOWUPS: 'crm.birthday-tasks',
    CUSTOMER_SEGMENTS: 'customers.recalculate-segments',
    HEALTH_ALERTS: 'system-health.evaluate-alerts',
    ACCOUNTING_RECURRING_VOUCHERS: 'accounting.post-due-recurring-vouchers',
    FEEDBACK_PLAN_BATCH: 'feedback-automation.batch-propose-plans',
    IMPORTS_LC_EXPIRY: 'imports.lc-expiry-alerts',
    HELD_ALERTS: 'notifications.send-held-alerts',
    ALERT_SCAN: 'alerts.scan-recent-activity',
    ANOMALY_DIGEST: 'alerts.daily-anomaly-digest',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The zone every `@Cron` in the backend states, spelled out in each decorator
 * so a schedule reads correctly on its own. Without one, `@nestjs/schedule`
 * runs in the server's zone — UTC on the VPS — and every "daily at 08:00" in
 * this codebase was 14:00 in Bangladesh. `cron-schedules.spec.ts` fails on a
 * `@Cron` without it.
 */
export const JOB_TIME_ZONE = 'Asia/Dhaka';

export interface JobDefinition {
    name: JobName;
    label: string;
    /**
     * Cron expression in {@link JOB_TIME_ZONE}, shown in the dashboard for
     * context. Must match the job's `@Cron` — `cron-schedules.spec.ts` checks.
     */
    schedule: string;
    /**
     * A successful run is expected at least this often. If the newest success
     * is older than this, the job is flagged overdue. Includes generous slack
     * over the nominal cadence so a slightly late run isn't a false alarm.
     */
    maxIntervalMs: number;
}

/**
 * Every scheduled job we expect to run, with its overdue threshold.
 *
 * ## When things run (all Bangladesh time, Asia/Dhaka = UTC+6, no DST)
 *
 * Moved 2026-10-04 (perceived-speed plan P3.6). Until then no `@Cron` named a
 * zone, so they ran in UTC and the heavy batch jobs landed between 06:00 and
 * 16:00 here — in shop hours. Heavy batch work now runs in a 01:00–05:00
 * window; reminders people see keep the exact instant they always had, only
 * written in local time; hourly and five-minute jobs are unchanged.
 *
 * | Job                                   | Before (UTC → BDT)       | After (BDT)        | Why                    |
 * |---------------------------------------|--------------------------|--------------------|------------------------|
 * | External sync (untracked)             | 02:00 → 08:00            | 01:00              | batch; first, feeds the rest |
 * | Notifications: purge expired data     | 03:00 → 09:00            | 01:30              | batch                  |
 * | Billing: retry failed payments        | 08:00 → 14:00            | 02:00              | batch; chain step 1    |
 * | Customers: recalculate segments       | 00:00 → 06:00            | 02:30              | batch; after the sync  |
 * | Billing: dunning                      | 09:00 → 15:00            | 03:00              | batch; chain step 2    |
 * | CRM: reorder reminder follow-ups      | 08:00 → 14:00            | 03:30              | batch; every quiet customer |
 * | Billing: post subscription period fees| 10:00 → 16:00            | 04:00              | batch; chain step 3    |
 * | Platform accounting sync (untracked)  | 03:00 → 09:00            | 05:00              | batch; an hour after the fees |
 * | Accounting: recurring vouchers        | 06:00 → 12:00            | 12:00              | kept                   |
 * | Notifications: low stock alerts       | 07:00 → 13:00            | 13:00              | kept                   |
 * | Imports: LC expiry alerts             | 07:00 → 13:00            | 13:00              | kept                   |
 * | Notifications: weekly reports         | Mon 07:00 → Mon 13:00    | Mon 13:00          | kept                   |
 * | Notifications: monthly reports        | 1st 07:00 → 1st 13:00    | 1st 13:00          | kept                   |
 * | Notifications: subscription expiry    | 08:00 → 14:00            | 14:00              | kept                   |
 * | CRM: birthday follow-ups              | 08:00 → 14:00            | 14:00              | kept                   |
 * | Feedback automation batch             | hourly                   | hourly             | unchanged              |
 * | Blog / tenant blog: publish scheduled | hourly (untracked)       | hourly             | unchanged              |
 * | CRM: process scheduled campaigns      | every 5 min              | every 5 min        | unchanged              |
 * | Alerts: scan recent activity          | — (new 2026-10-08)       | every 5 min        | mobile alerts          |
 * | Notifications: send held alerts       | — (new 2026-10-08)       | every 15 min       | after quiet hours      |
 * | Alerts: daily anomaly digest          | — (new 2026-10-08)       | 20:30              | after the shop day     |
 * | System health: evaluate alerts        | every 5 min              | every 5 min        | unchanged              |
 *
 * The billing chain keeps its order and hour spacing (retry → dunning → fees),
 * and the platform ledger sync now really does run an hour after the fees, as
 * its doc comment always said. Nothing in the chain reads another step's output
 * the same night — dunning and the fee pass re-read the ledger — so the order
 * decides what a tenant hears when, not whether the books are right.
 *
 * On the day this ships, a moved job runs twice within a day if the deploy
 * lands after its old time and before its new one, and otherwise waits up to
 * 24 hours plus its shift for its first new run — about 36 hours for the
 * billing chain after a daytime deploy, at most about 44 for segments and the
 * ledger sync. The jobs are idempotent (reminders are gated on
 * `last_reminder_at`, suspensions on `billing_suspended_at`, fees and
 * follow-ups on existing rows), so the visible effects are a skipped day of
 * payment reminders at most, and a one-off "overdue" flag on this dashboard
 * (`maxIntervalMs` allows 26 hours) until the first night's run.
 */
export const JOB_REGISTRY: JobDefinition[] = [
    { name: JOB_NAMES.BILLING_RETRY, label: 'Billing: retry failed payments', schedule: '0 2 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.BILLING_DUNNING, label: 'Billing: dunning', schedule: '0 3 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.BILLING_PERIOD_FEES, label: 'Billing: post subscription period fees', schedule: '0 4 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_EXPIRY_WARNINGS, label: 'Notifications: subscription expiry warnings', schedule: '0 14 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_LOW_STOCK, label: 'Notifications: low stock alerts', schedule: '0 13 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_WEEKLY, label: 'Notifications: weekly reports', schedule: '0 13 * * 1', maxIntervalMs: 7 * DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_MONTHLY, label: 'Notifications: monthly reports', schedule: '0 13 1 * *', maxIntervalMs: 31 * DAY + 2 * HOUR },
    { name: JOB_NAMES.NOTIFICATIONS_PURGE, label: 'Notifications: purge expired data', schedule: '30 1 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.CRM_CAMPAIGNS, label: 'CRM: process scheduled campaigns', schedule: '*/5 * * * *', maxIntervalMs: 15 * 60 * 1000 },
    { name: JOB_NAMES.CRM_REORDER_FOLLOWUPS, label: 'CRM: reorder reminder follow-ups', schedule: '30 3 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.CRM_BIRTHDAY_FOLLOWUPS, label: 'CRM: birthday follow-ups', schedule: '0 14 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.CUSTOMER_SEGMENTS, label: 'Customers: recalculate segments', schedule: '30 2 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.HEALTH_ALERTS, label: 'System health: evaluate alerts', schedule: '*/5 * * * *', maxIntervalMs: 15 * 60 * 1000 },
    { name: JOB_NAMES.ACCOUNTING_RECURRING_VOUCHERS, label: 'Accounting: post due recurring vouchers', schedule: '0 12 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.FEEDBACK_PLAN_BATCH, label: 'Feedback automation: batch propose plans', schedule: '0 * * * *', maxIntervalMs: 2 * HOUR },
    { name: JOB_NAMES.IMPORTS_LC_EXPIRY, label: 'Imports: LC expiry and acceptance maturity alerts', schedule: '0 13 * * *', maxIntervalMs: DAY + 2 * HOUR },
    { name: JOB_NAMES.HELD_ALERTS, label: 'Notifications: send alerts held for quiet hours', schedule: '*/15 * * * *', maxIntervalMs: 45 * 60 * 1000 },
    { name: JOB_NAMES.ALERT_SCAN, label: 'Alerts: scan recent sales, refunds, tills and enquiries', schedule: '*/5 * * * *', maxIntervalMs: 15 * 60 * 1000 },
    { name: JOB_NAMES.ANOMALY_DIGEST, label: 'Alerts: daily anomaly digest', schedule: '30 20 * * *', maxIntervalMs: DAY + 2 * HOUR },
];
