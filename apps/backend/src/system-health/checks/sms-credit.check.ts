import { Injectable } from '@nestjs/common';
import type { CheckResult } from '@erp71/shared-types';
import { DatabaseService } from '../../database/database.service';

/** A tenant at or below this many SMS credits is considered low. */
const SMS_CREDIT_LOW_THRESHOLD = parseInt(process.env.SMS_CREDIT_LOW_THRESHOLD ?? '100', 10);
/** Number of low-credit active tenants that trips degraded (and an alert). */
const SMS_CREDIT_LOW_TENANTS_ALERT = parseInt(process.env.SMS_CREDIT_LOW_TENANTS_ALERT ?? '5', 10);

/**
 * Counts active SMS users (tenants with ledger history) running low on prepaid
 * credit. Non-critical and informational unless many tenants are affected, in
 * which case it degrades so the alerting path picks it up.
 */
@Injectable()
export class SmsCreditCheck {
    constructor(private readonly db: DatabaseService) {}

    async run(): Promise<CheckResult> {
        const base: Pick<CheckResult, 'name' | 'label' | 'critical'> = {
            name: 'sms_credit',
            label: 'SMS credit',
            critical: false,
        };

        try {
            // Only count tenants that actually use SMS (have ledger entries) and
            // are at/below the low threshold — excludes tenants that never bought.
            const lowTenants = await this.db.tenant.count({
                where: {
                    sms_credits: { lte: SMS_CREDIT_LOW_THRESHOLD },
                    smsTransactions: { some: {} },
                },
            });

            const details = {
                low_credit_tenants: lowTenants,
                threshold: SMS_CREDIT_LOW_THRESHOLD,
                alert_at: SMS_CREDIT_LOW_TENANTS_ALERT,
            };

            if (lowTenants >= SMS_CREDIT_LOW_TENANTS_ALERT) {
                return {
                    ...base,
                    state: 'degraded',
                    message: `${lowTenants} tenant(s) at or below ${SMS_CREDIT_LOW_THRESHOLD} SMS credits`,
                    details,
                };
            }

            return { ...base, state: 'ok', details };
        } catch (err) {
            return {
                ...base,
                state: 'unknown',
                message: err instanceof Error ? err.message : 'Could not read SMS credit balances',
            };
        }
    }
}
