/**
 * The contract every payment adapter implements. One adapter per *protocol*,
 * not per brand: a provider row names its adapter and supplies the credentials
 * and configuration, so several businesses can share one implementation.
 */

export type GatewayMode = 'sandbox' | 'live';

export interface InitiatePaymentInput {
    /** Our own reference sent to the gateway as the transaction id. */
    paymentId: string;
    orderId: string;
    /** Short human reference shown in the shop's order list. */
    orderRef: string;
    amount: number;
    currency: string;
    description: string;
    customer: {
        name: string;
        email: string;
        phone?: string | null;
        address?: string | null;
        city?: string | null;
    };
    successUrl: string;
    failUrl: string;
    cancelUrl: string;
    credentials: Record<string, string>;
    config: Record<string, unknown>;
    mode: GatewayMode;
}

export interface InitiatePaymentResult {
    /** Where the shopper's browser must be sent. */
    redirectUrl: string;
    /** The gateway's own reference, when it differs from ours. */
    providerReference: string;
    raw: unknown;
}

export interface VerifyPaymentInput {
    /** Our reference to match against. */
    paymentReference: string;
    /** Provider-specific callback payload (the gateway POSTs a form or GETs a query). */
    callback: Record<string, unknown>;
    /** 'success' | 'fail' | 'cancel' from the callback route. */
    outcome: 'success' | 'fail' | 'cancel';
    credentials: Record<string, string>;
    config: Record<string, unknown>;
    mode: GatewayMode;
}

export interface VerifyPaymentResult {
    paid: boolean;
    providerReference: string;
    /** Amount the gateway says it received, when it reports one. */
    amount?: number;
    currency?: string;
    status?: string;
    raw: unknown;
    reason?: string;
}

export interface PaymentAdapter {
    initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
    verify(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
}
