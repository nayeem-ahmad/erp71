import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type {
    InitiatePaymentInput,
    InitiatePaymentResult,
    PaymentAdapter,
    VerifyPaymentInput,
    VerifyPaymentResult,
} from './payment-adapter';

const SANDBOX_API = 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
const LIVE_API = 'https://securepay.sslcommerz.com/gwprocess/v4/api.php';
const SANDBOX_VALIDATE = 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';
const LIVE_VALIDATE = 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php';

/**
 * SSLCommerz's hosted checkout.
 *
 * Credentials are the shop's own `store_id` + `store_password`; there is no
 * platform-level merchant here, so every session settles into the shop's own
 * account. Field names and the validation call are what SSLCommerz documents
 * for its v4 gateway.
 */
export class SslCommerzAdapter implements PaymentAdapter {
    async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
        const storeId = input.credentials.store_id?.trim();
        const storePassword = input.credentials.store_password;
        if (!storeId || !storePassword) {
            throw new BadRequestException('SSLCommerz merchant credentials are not configured.');
        }

        const apiUrl = this.configUrl(input.config.initiate_url, input.mode === 'live' ? LIVE_API : SANDBOX_API);
        const body = new URLSearchParams({
            store_id: storeId,
            store_passwd: storePassword,
            total_amount: input.amount.toFixed(2),
            currency: input.currency,
            tran_id: input.paymentId,
            success_url: input.successUrl,
            fail_url: input.failUrl,
            cancel_url: input.cancelUrl,
            cus_name: input.customer.name || 'Customer',
            cus_email: input.customer.email,
            cus_phone: input.customer.phone || '',
            cus_add1: input.customer.address || '',
            cus_city: input.customer.city || '',
            cus_country: 'Bangladesh',
            shipping_method: 'NO',
            num_of_item: '1',
            product_name: input.description,
            product_category: 'General',
            product_profile: 'general',
            // Our own order reference, so a support agent can match a gateway
            // transaction to an order without the payment row.
            value_a: input.orderId,
            value_b: input.paymentId,
        });

        const response = await this.fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const payload = await this.parseJson(response);

        if (!response.ok || !payload.GatewayPageURL) {
            throw new InternalServerErrorException(
                payload.failedreason || 'SSLCommerz checkout initialization failed.',
            );
        }

        return {
            redirectUrl: String(payload.GatewayPageURL),
            providerReference: input.paymentId,
            raw: payload,
        };
    }

    async verify(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
        const raw = input.callback;
        const providerReference = String(
            raw.tran_id ?? input.paymentReference,
        );

        if (input.outcome !== 'success') {
            return {
                paid: false,
                providerReference,
                status: input.outcome.toUpperCase(),
                raw,
                reason: `Shopper ${input.outcome === 'cancel' ? 'cancelled' : 'did not complete'} the payment.`,
            };
        }

        const valId = typeof raw.val_id === 'string' ? raw.val_id : undefined;
        if (!valId) {
            return {
                paid: false,
                providerReference,
                raw,
                reason: 'SSLCommerz returned no validation id.',
            };
        }

        const storeId = input.credentials.store_id?.trim();
        const storePassword = input.credentials.store_password;
        if (!storeId || !storePassword) {
            throw new BadRequestException('SSLCommerz merchant credentials are not configured.');
        }

        const validationUrl = this.configUrl(
            input.config.validation_url,
            input.mode === 'live' ? LIVE_VALIDATE : SANDBOX_VALIDATE,
        );
        const url = new URL(validationUrl);
        url.searchParams.set('val_id', valId);
        url.searchParams.set('store_id', storeId);
        url.searchParams.set('store_passwd', storePassword);
        url.searchParams.set('format', 'json');

        const response = await this.fetchWithTimeout(url.toString(), { method: 'GET' });
        const payload = await this.parseJson(response);

        if (!response.ok) {
            throw new InternalServerErrorException('Failed to validate the SSLCommerz payment.');
        }

        if (payload.tran_id && String(payload.tran_id) !== input.paymentReference) {
            return {
                paid: false,
                providerReference,
                raw: payload,
                reason: 'SSLCommerz transaction reference does not match this payment.',
            };
        }

        const status = String(payload.status ?? '').toUpperCase();
        const paid = status === 'VALID' || status === 'VALIDATED' || status === 'SUCCESS';
        const amount = payload.amount === undefined ? undefined : Number(payload.amount);

        return {
            paid,
            providerReference: String(payload.tran_id ?? providerReference),
            amount: Number.isFinite(amount) ? amount : undefined,
            currency: payload.currency ? String(payload.currency) : undefined,
            status,
            raw: payload,
            reason: paid ? undefined : 'SSLCommerz did not validate the payment.',
        };
    }

    private configUrl(value: unknown, fallback: string): string {
        return typeof value === 'string' && value.trim() ? value.trim() : fallback;
    }

    private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            return await fetch(url, { ...init, signal: controller.signal });
        } catch {
            throw new InternalServerErrorException('The payment gateway could not be reached.');
        } finally {
            clearTimeout(timer);
        }
    }

    private async parseJson(response: Response): Promise<Record<string, any>> {
        const text = await response.text();
        try {
            return JSON.parse(text || '{}');
        } catch {
            throw new InternalServerErrorException('The payment gateway returned an unreadable response.');
        }
    }
}
