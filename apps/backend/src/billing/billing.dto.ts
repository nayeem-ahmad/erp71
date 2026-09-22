import {
    IsIn,
    IsOptional,
    IsString,
    IsBoolean,
    IsNumber,
    IsArray,
    IsDateString,
    Min,
    MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SUBSCRIPTION_PLAN_CODES } from '@erp71/shared-types';

const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'TRIALING'] as const;

export class CreateCheckoutSessionDto {
    @IsIn(SUBSCRIPTION_PLAN_CODES)
    planCode!: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

    @IsOptional()
    @IsIn(BILLING_CYCLES)
    billingCycle?: 'MONTHLY' | 'YEARLY';

    /** Add-on module codes to purchase alongside the plan, billed in the same checkout. */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    addonCodes?: string[];
}

export class ConfirmCheckoutDto {
    @IsIn(SUBSCRIPTION_PLAN_CODES)
    planCode!: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

    @IsOptional()
    @IsIn(BILLING_CYCLES)
    billingCycle?: 'MONTHLY' | 'YEARLY';

    @IsOptional()
    @IsString()
    reference?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    addonCodes?: string[];
}

/**
 * Payment-gateway callback payload (SSL Wireless success/fail/cancel/IPN).
 *
 * Deliberately not exhaustive: the provider posts more fields than these, and
 * arrives on routes that take both `@Body` and `@Query`. The endpoints that
 * use it therefore run a non-strict pipe — see the controller — because
 * rejecting a real payment callback over an undeclared field loses money,
 * where accepting a superset does not. The service reads only what it needs.
 */
export class BillingCallbackDto {
    @IsOptional()
    @IsString()
    tran_id?: string;

    @IsOptional()
    @IsString()
    val_id?: string;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsString()
    amount?: string;

    @IsOptional()
    @IsString()
    currency?: string;

    @IsOptional()
    @IsString()
    value_a?: string;

    @IsOptional()
    @IsString()
    value_b?: string;

    @IsOptional()
    @IsString()
    value_c?: string;

    @IsOptional()
    @IsString()
    value_d?: string;
}

export class ManualBillingWebhookDto {
    /** Not @IsUUID: the service resolves the tenant by lookup, and this is an
     * operator-driven webhook whose callers pass whatever id they hold. */
    @IsString()
    tenantId!: string;

    @IsIn(SUBSCRIPTION_PLAN_CODES)
    planCode!: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

    @IsOptional()
    @IsIn(SUBSCRIPTION_STATUSES)
    status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';

    @IsOptional()
    @IsIn(BILLING_CYCLES)
    billingCycle?: 'MONTHLY' | 'YEARLY';

    @IsOptional()
    @IsDateString()
    currentPeriodStart?: string;

    @IsOptional()
    @IsDateString()
    currentPeriodEnd?: string;

    @IsOptional()
    @IsBoolean()
    cancelAtPeriodEnd?: boolean;

    @IsOptional()
    @IsString()
    providerName?: string;

    @IsOptional()
    @IsString()
    providerCustomerRef?: string;

    @IsOptional()
    @IsString()
    providerSubscriptionRef?: string;

    /** Idempotency key — duplicate webhooks with the same key are ignored. */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    externalEventId?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    addonCodes?: string[];
}

export class RefundBillingDto {
    @IsString()
    referenceId!: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    amount?: number;

    @IsOptional()
    @IsString()
    currency?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;

    /** When true, downgrade the tenant to FREE after recording the refund. */
    @IsOptional()
    @IsBoolean()
    downgradeToFree?: boolean;

    /** Idempotency key for duplicate-safe refund processing. */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    idempotencyKey?: string;
}
