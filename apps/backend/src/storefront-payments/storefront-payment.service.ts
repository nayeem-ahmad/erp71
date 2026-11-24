import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { PaymentProviderCatalogService } from './payment-provider-catalog.service';
import { StorefrontOrderBillingService } from './storefront-order-billing.service';
import { SslCommerzAdapter } from './adapters/sslcommerz.adapter';
import { HostedRedirectAdapter } from './adapters/hosted-redirect.adapter';
import type {
    InitiatePaymentInput,
    PaymentAdapter,
    VerifyPaymentInput,
    VerifyPaymentResult,
} from './adapters/payment-adapter';
import { storefrontOrderRef } from '@erp71/shared-types';

type CallbackOutcome = 'success' | 'fail' | 'cancel';

/**
 * Opens gateway sessions for storefront orders and settles the callbacks.
 *
 * Every session is opened with the *shop's* credentials, resolved from its own
 * `TenantStorefrontGateway` row — the platform is not the merchant and never
 * receives the money. A shop with no enabled gateway simply cannot be offered
 * online payment.
 */
@Injectable()
export class StorefrontPaymentService {
    private readonly logger = new Logger(StorefrontPaymentService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly catalog: PaymentProviderCatalogService,
        private readonly billing: StorefrontOrderBillingService,
    ) {}

    async initiate(slug: string, orderId: string, providerCode: string, customerEmail: string) {
        const tenant = await this.findStorefrontTenant(slug);
        const order = await this.db.storefrontOrder.findFirst({
            where: { id: orderId, tenantId: tenant.id },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (order.payment_status === 'PAID') {
            throw new BadRequestException('This order has already been paid.');
        }
        if (order.status === 'CANCELLED') {
            throw new BadRequestException('This order was cancelled.');
        }
        if (order.customerEmail.trim().toLowerCase() !== customerEmail.trim().toLowerCase()) {
            throw new BadRequestException('The email does not match this order.');
        }

        const gateway = await this.catalog.resolveGateway(tenant.id, providerCode);
        const adapter = this.adapterFor(gateway.adapter);

        const payment = await this.db.storefrontPayment.create({
            data: {
                tenantId: tenant.id,
                orderId: order.id,
                providerCode,
                providerPaymentId: `sp_${randomUUID().replaceAll('-', '')}`,
                amount: order.totalAmount,
                currency: gateway.currency,
                status: 'PENDING',
                mode: gateway.mode,
            },
        });

        const base = this.publicApiBase();
        const callback = `${base}/storefront/${encodeURIComponent(slug)}/payments/${encodeURIComponent(providerCode)}/callback`;
        const input: InitiatePaymentInput = {
            paymentId: payment.providerPaymentId,
            orderId: order.id,
            orderRef: storefrontOrderRef(order.id),
            amount: Number(order.totalAmount),
            currency: gateway.currency,
            description: `${tenant.name} order ${storefrontOrderRef(order.id)}`,
            customer: {
                name: order.customerName,
                email: order.customerEmail,
                phone: order.customerPhone,
                address: order.deliveryAddress,
                city: order.deliveryArea,
            },
            successUrl: `${callback}?outcome=success`,
            failUrl: `${callback}?outcome=fail`,
            cancelUrl: `${callback}?outcome=cancel`,
            credentials: gateway.credentials,
            config: gateway.config,
            mode: gateway.mode,
        };

        try {
            const result = await adapter.initiate(input);
            await this.db.storefrontPayment.update({
                where: { id: payment.id },
                data: { raw: (result.raw ?? {}) as object },
            });
            await this.db.storefrontOrder.update({
                where: { id: order.id },
                data: {
                    payment_method: providerCode,
                    payment_provider: providerCode,
                    payment_status: 'PENDING',
                },
            });

            return { paymentId: payment.id, redirectUrl: result.redirectUrl };
        } catch (error) {
            const reason = (error as Error)?.message ?? 'Payment could not be started.';
            this.logger.warn(
                `Could not start ${providerCode} payment for order ${order.id} (${tenant.name}): ${reason}`,
            );
            await this.db.storefrontPayment.update({
                where: { id: payment.id },
                data: { status: 'FAILED' },
            });
            await this.catalog.recordGatewayError(tenant.id, providerCode, reason);
            throw error;
        }
    }

    /**
     * Settles a provider callback. Never throws for a shopper-facing failure:
     * the browser is sent back to the storefront with a status it can explain.
     * A replayed callback is harmless because only the first one moves the
     * payment out of `PENDING`.
     */
    async handleCallback(
        slug: string,
        providerCode: string,
        outcome: CallbackOutcome,
        callback: Record<string, unknown>,
    ): Promise<{ redirectUrl: string; orderId: string | null; status: string }> {
        const tenant = await this.findStorefrontTenant(slug);
        const gateway = await this.catalog.resolveGatewayForCallback(tenant.id, providerCode);
        const adapter = this.adapterFor(gateway.adapter);

        const payment = await this.findPayment(tenant.id, providerCode, callback);
        if (!payment) {
            this.logger.warn(`No payment matched a ${providerCode} callback for tenant ${tenant.id}.`);
            return {
                redirectUrl: this.frontendReturnUrl(slug, null, 'failed'),
                orderId: null,
                status: 'failed',
            };
        }

        let result: VerifyPaymentResult;
        try {
            const input: VerifyPaymentInput = {
                paymentReference: payment.providerPaymentId,
                callback,
                outcome,
                credentials: gateway.credentials,
                config: gateway.config,
                mode: gateway.mode,
            };
            result = await adapter.verify(input);
        } catch (error) {
            this.logger.warn(`Payment verification failed: ${(error as Error)?.message ?? error}`);
            const downgraded = await this.db.storefrontPayment.updateMany({
                where: { id: payment.id, status: { not: 'PAID' } },
                data: { status: 'FAILED', raw: callback as object },
            });
            await this.catalog.recordGatewayError(
                tenant.id,
                providerCode,
                (error as Error)?.message ?? 'Payment verification failed.',
            );
            const alreadyPaid = downgraded.count === 0;
            return {
                redirectUrl: this.frontendReturnUrl(slug, payment.orderId, alreadyPaid ? 'paid' : 'failed'),
                orderId: payment.orderId,
                status: alreadyPaid ? 'paid' : 'failed',
            };
        }

        const amountMatches =
            result.amount === undefined ||
            Math.abs(Number(payment.amount) - result.amount) <= 0.05;
        const currencyMatches =
            !result.currency || result.currency.toUpperCase() === payment.currency.toUpperCase();

        if (!result.paid || !amountMatches || !currencyMatches) {
            const status = result.paid ? 'failed' : outcome === 'cancel' ? 'cancelled' : 'failed';
            // A replay cannot undo a settled payment: only move a payment that
            // has not already been marked PAID.
            const downgraded = await this.db.storefrontPayment.updateMany({
                where: { id: payment.id, status: { not: 'PAID' } },
                data: { status: 'FAILED', raw: (result.raw ?? callback) as object },
            });
            if (downgraded.count === 0) {
                return {
                    redirectUrl: this.frontendReturnUrl(slug, payment.orderId, 'paid'),
                    orderId: payment.orderId,
                    status: 'paid',
                };
            }
            await this.db.storefrontOrder.update({
                where: { id: payment.orderId },
                data: { payment_status: 'FAILED' },
            });
            this.logger.warn(
                `Payment ${payment.id} not paid: ${result.reason ?? 'verification failed'}` +
                    `${amountMatches ? '' : ' (amount mismatch)'}${currencyMatches ? '' : ' (currency mismatch)'}`,
            );
            return {
                redirectUrl: this.frontendReturnUrl(slug, payment.orderId, status),
                orderId: payment.orderId,
                status,
            };
        }

        const settled = await this.db.$transaction(async (tx) => {
            const moved = await tx.storefrontPayment.updateMany({
                where: { id: payment.id, status: { not: 'PAID' } },
                data: {
                    status: 'PAID',
                    providerPaymentId: result.providerReference || payment.providerPaymentId,
                    raw: (result.raw ?? callback) as object,
                },
            });
            if (moved.count === 0) return false;

            await tx.storefrontOrder.update({
                where: { id: payment.orderId },
                data: {
                    payment_status: 'PAID',
                    payment_provider: providerCode,
                    gateway_payment_id: result.providerReference || payment.providerPaymentId,
                    paid_at: new Date(),
                },
            });
            return true;
        });

        // The money is real: turn the order into a Sale so stock leaves a
        // branch and the ledger gets its Dr <tender> / Cr revenue voucher.
        // Billing never throws — a bookkeeping failure must not turn a
        // confirmed payment into a failed-looking redirect.
        if (settled) {
            await this.billing.billOrder(tenant.id, payment.orderId, 'paid');
        }

        return {
            redirectUrl: this.frontendReturnUrl(slug, payment.orderId, 'paid'),
            orderId: payment.orderId,
            status: 'paid',
        };
    }

    /** Minimal, public status read for the storefront's return page. */
    async getPaymentStatus(slug: string, paymentId: string) {
        const tenant = await this.findStorefrontTenant(slug);
        const payment = await this.db.storefrontPayment.findFirst({
            where: { id: paymentId, tenantId: tenant.id },
            select: {
                id: true,
                orderId: true,
                providerCode: true,
                amount: true,
                currency: true,
                status: true,
                created_at: true,
            },
        });
        if (!payment) throw new NotFoundException('Payment not found');
        return {
            id: payment.id,
            order_id: payment.orderId,
            provider: payment.providerCode,
            amount: Number(payment.amount),
            currency: payment.currency,
            status: payment.status,
            created_at: payment.created_at,
        };
    }

    private async findPayment(tenantId: string, providerCode: string, callback: Record<string, unknown>) {
        const candidates = [callback.tran_id, callback.value_b]
            .map((value) => (typeof value === 'string' ? value : undefined))
            .filter((value): value is string => Boolean(value));

        for (const reference of candidates) {
            const payment = await this.db.storefrontPayment.findFirst({
                where: { tenantId, providerCode, providerPaymentId: reference },
            });
            if (payment) return payment;
        }

        // Some gateways echo only our order id (`value_a`); fall back to the
        // newest attempt for that order.
        const orderId = typeof callback.value_a === 'string' ? callback.value_a : undefined;
        if (orderId) {
            return this.db.storefrontPayment.findFirst({
                where: { tenantId, providerCode, orderId },
                orderBy: { created_at: 'desc' },
            });
        }
        return null;
    }

    private adapterFor(adapter: string): PaymentAdapter {
        if (adapter === 'SSLCOMMERZ') return new SslCommerzAdapter();
        return new HostedRedirectAdapter();
    }

    private async findStorefrontTenant(slug: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { storefront_slug: slug, storefront_enabled: true, deleted_at: null },
            select: { id: true, name: true },
        });
        if (!tenant) throw new NotFoundException('Storefront not found or not available');
        return tenant;
    }

    private publicApiBase(): string {
        const origin = (process.env.BACKEND_PUBLIC_URL || 'http://localhost:4000').replace(/\/+$/, '');
        return origin.endsWith('/api/v1') ? origin : `${origin}/api/v1`;
    }

    private frontendReturnUrl(slug: string, orderId: string | null, status: string): string {
        const origin = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
        const params = new URLSearchParams({ status });
        if (orderId) params.set('orderId', orderId);
        return `${origin}/store/${encodeURIComponent(slug)}/payment/return?${params.toString()}`;
    }
}
