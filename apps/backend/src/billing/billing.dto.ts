export class CreateCheckoutSessionDto {
    planCode!: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    billingCycle?: 'MONTHLY' | 'YEARLY';
}

export class ConfirmCheckoutDto {
    planCode!: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    billingCycle?: 'MONTHLY' | 'YEARLY';
    reference?: string;
}

export class BillingCallbackDto {
    tran_id?: string;
    val_id?: string;
    status?: string;
    amount?: string;
    currency?: string;
    value_a?: string;
    value_b?: string;
    value_c?: string;
    value_d?: string;
}

export class ManualBillingWebhookDto {
    tenantId!: string;
    planCode!: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
    billingCycle?: 'MONTHLY' | 'YEARLY';
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
    providerName?: string;
    providerCustomerRef?: string;
    providerSubscriptionRef?: string;
    /** Idempotency key — duplicate webhooks with the same key are ignored. */
    externalEventId?: string;
}

export class RefundBillingDto {
    referenceId!: string;
    amount?: number;
    currency?: string;
    reason?: string;
    /** When true, downgrade the tenant to FREE after recording the refund. */
    downgradeToFree?: boolean;
    /** Idempotency key for duplicate-safe refund processing. */
    idempotencyKey?: string;
}