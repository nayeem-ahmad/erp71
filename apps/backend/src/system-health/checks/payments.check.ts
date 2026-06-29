import { Injectable } from '@nestjs/common';
import type { CheckResult } from '@erp71/shared-types';
import { DatabaseService } from '../../database/database.service';

/** Number of FAILED billing/webhook events in the window that trips degraded. */
const PAYMENT_FAILURE_THRESHOLD = parseInt(process.env.HEALTH_PAYMENT_FAILURE_THRESHOLD ?? '3', 10);
/** Look-back window for counting payment failures, in minutes. */
const PAYMENT_FAILURE_WINDOW_MIN = parseInt(process.env.HEALTH_PAYMENT_FAILURE_WINDOW_MIN ?? '60', 10);

/**
 * Flags a spike in failed payment/webhook events. Non-critical: a payment
 * provider issue degrades the platform but doesn't take it down. Feeds both
 * the health report and threshold alerting.
 */
@Injectable()
export class PaymentsCheck {
    constructor(private readonly db: DatabaseService) {}

    async run(): Promise<CheckResult> {
        const base: Pick<CheckResult, 'name' | 'label' | 'critical'> = {
            name: 'payments',
            label: 'Payment webhooks',
            critical: false,
        };

        try {
            const since = new Date(Date.now() - PAYMENT_FAILURE_WINDOW_MIN * 60 * 1000);
            const failures = await this.db.billingEvent.count({
                where: { status: 'FAILED', created_at: { gte: since } },
            });

            const details = {
                failures,
                window_minutes: PAYMENT_FAILURE_WINDOW_MIN,
                threshold: PAYMENT_FAILURE_THRESHOLD,
            };

            if (failures >= PAYMENT_FAILURE_THRESHOLD) {
                return {
                    ...base,
                    state: 'degraded',
                    message: `${failures} payment webhook failure(s) in the last ${PAYMENT_FAILURE_WINDOW_MIN}m`,
                    details,
                };
            }

            return { ...base, state: 'ok', details };
        } catch (err) {
            return {
                ...base,
                state: 'unknown',
                message: err instanceof Error ? err.message : 'Could not read billing events',
            };
        }
    }
}
