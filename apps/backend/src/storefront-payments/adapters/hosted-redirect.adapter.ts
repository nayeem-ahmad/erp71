import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { HostedRedirectProviderConfig } from '@erp71/shared-types';
import type {
    InitiatePaymentInput,
    InitiatePaymentResult,
    PaymentAdapter,
    VerifyPaymentInput,
    VerifyPaymentResult,
} from './payment-adapter';

/**
 * A gateway that follows the common hosted-checkout shape: the shopper is sent
 * to the provider with a form (or query) built from `field_map`, the provider
 * brings them back with a reference, and the reference is confirmed against a
 * server-to-server validation endpoint.
 *
 * Everything is read from the provider's `config` JSON, so a new provider using
 * this shape is added from the admin console without touching code. A gateway
 * that needs a bespoke handshake (token grants, request signing) still needs its
 * own adapter.
 */
export class HostedRedirectAdapter implements PaymentAdapter {
    async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
        const config = this.config(input.config);
        const params = this.renderFields(config.field_map, input);

        if ((config.method ?? 'POST').toUpperCase() === 'GET') {
            const url = new URL(config.initiate_url);
            for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
            return { redirectUrl: url.toString(), providerReference: input.paymentId, raw: { url: url.toString() } };
        }

        const response = await this.fetchWithTimeout(config.initiate_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params).toString(),
        });

        const redirectUrl = await this.readRedirectUrl(response, config);
        if (!redirectUrl) {
            throw new InternalServerErrorException('The payment gateway did not return a checkout URL.');
        }

        return { redirectUrl, providerReference: input.paymentId, raw: { redirectUrl } };
    }

    async verify(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
        const config = this.config(input.config);
        const callbackReference = config.reference_param
            ? String(input.callback[config.reference_param] ?? '')
            : input.paymentReference;

        if (input.outcome !== 'success') {
            return {
                paid: false,
                providerReference: callbackReference || input.paymentReference,
                status: input.outcome.toUpperCase(),
                raw: input.callback,
                reason: `Shopper ${input.outcome === 'cancel' ? 'cancelled' : 'did not complete'} the payment.`,
            };
        }

        if (!config.validation_url) {
            throw new BadRequestException('This payment provider has no validation endpoint configured.');
        }

        const url = new URL(config.validation_url.replaceAll('{paymentRef}', encodeURIComponent(callbackReference)));
        const response = await this.fetchWithTimeout(url.toString(), { method: 'GET' });
        if (!response.ok) {
            throw new InternalServerErrorException('Failed to validate the payment with the gateway.');
        }

        const payload = await this.parseJson(response);
        const status = config.validation_status_path
            ? String(this.dotGet(payload, config.validation_status_path) ?? '').toUpperCase()
            : '';
        const successValues = (config.validation_success_values ?? ['VALID', 'VALIDATED', 'SUCCESS']).map((value) =>
            value.toUpperCase(),
        );
        const paid = successValues.includes(status);

        const amountValue = config.validation_amount_path
            ? Number(this.dotGet(payload, config.validation_amount_path))
            : undefined;
        const currencyValue = config.validation_currency_path
            ? String(this.dotGet(payload, config.validation_currency_path) ?? '')
            : undefined;
        const referenceValue = config.validation_reference_path
            ? String(this.dotGet(payload, config.validation_reference_path) ?? '')
            : callbackReference;

        return {
            paid,
            providerReference: referenceValue || input.paymentReference,
            amount: Number.isFinite(amountValue) ? amountValue : undefined,
            currency: currencyValue || undefined,
            status,
            raw: payload,
            reason: paid ? undefined : 'The gateway did not validate the payment.',
        };
    }

    private config(raw: Record<string, unknown>): HostedRedirectProviderConfig {
        const config = raw as unknown as HostedRedirectProviderConfig;
        if (!config.initiate_url) {
            throw new BadRequestException('This payment provider has no checkout URL configured.');
        }
        return config;
    }

    private renderFields(
        fieldMap: Record<string, string>,
        input: InitiatePaymentInput,
    ): Record<string, string> {
        const values: Record<string, string> = {
            amount: input.amount.toFixed(2),
            currency: input.currency,
            orderId: input.orderId,
            orderRef: input.orderRef,
            paymentId: input.paymentId,
            customerName: input.customer.name,
            customerEmail: input.customer.email,
            customerPhone: input.customer.phone ?? '',
            successUrl: input.successUrl,
            failUrl: input.failUrl,
            cancelUrl: input.cancelUrl,
        };

        const rendered: Record<string, string> = {};
        for (const [gatewayField, template] of Object.entries(fieldMap)) {
            rendered[gatewayField] = String(template).replace(/\{(\w+)\}/g, (_match, token: string) =>
                String(values[token] ?? ''),
            );
        }
        return rendered;
    }

    private async readRedirectUrl(
        response: Response,
        config: HostedRedirectProviderConfig,
    ): Promise<string | null> {
        if ((config.response_type ?? 'json') === 'redirect') {
            return response.url || response.headers.get('location');
        }

        const text = await response.text();
        let payload: Record<string, unknown>;
        try {
            payload = JSON.parse(text || '{}');
        } catch {
            throw new InternalServerErrorException('The payment gateway returned an unreadable response.');
        }
        const value = config.response_url_path ? this.dotGet(payload, config.response_url_path) : undefined;
        return typeof value === 'string' ? value : null;
    }

    private dotGet(source: unknown, path: string): unknown {
        return path.split('.').reduce<unknown>((current, key) => {
            if (current && typeof current === 'object') {
                return (current as Record<string, unknown>)[key];
            }
            return undefined;
        }, source);
    }

    private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
        } catch {
            throw new InternalServerErrorException('The payment gateway could not be reached.');
        } finally {
            clearTimeout(timer);
        }
    }

    private async parseJson(response: Response): Promise<Record<string, unknown>> {
        const text = await response.text();
        try {
            return JSON.parse(text || '{}');
        } catch {
            throw new InternalServerErrorException('The payment gateway returned an unreadable response.');
        }
    }
}
