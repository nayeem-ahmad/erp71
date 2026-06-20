import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';
import { CircuitOpenError } from '../system-health/resilience/circuit-breaker';
import * as Sentry from '@sentry/nestjs';
import {
    BillingCallbackDto,
    ConfirmCheckoutDto,
    CreateCheckoutSessionDto,
    ManualBillingWebhookDto,
    RefundBillingDto,
} from './billing.dto';

type BillingCycle = 'MONTHLY' | 'YEARLY';
type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
type BillingProviderName = 'manual' | 'ssl-wireless';
type SslWirelessCallbackMode = 'success' | 'fail' | 'cancel' | 'ipn';
type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

@Injectable()
export class BillingService {
    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
        private readonly email: EmailService,
        private readonly breakers: CircuitBreakerRegistry,
    ) {}

    async getSummary(userId: string, tenantId: string) {
        const membership = await this.requireTenantMembership(userId, tenantId);
        const [plans, subscription] = await Promise.all([
            this.db.subscriptionPlan.findMany({
                where: { is_active: true },
                orderBy: { monthly_price: 'asc' },
            }),
            this.db.tenantSubscription.findUnique({
                where: { tenant_id: tenantId },
                include: { plan: true },
            }),
        ]);

        return {
            tenant: {
                id: membership.tenant.id,
                name: membership.tenant.name,
            },
            role: membership.role,
            can_manage_billing: this.canManageBilling(membership.role),
            provider_name: this.getProviderName(),
            subscription: this.mapSubscription(subscription),
            available_plans: plans.map((plan) => this.mapPlan(plan)),
            billing_history: await this.getBillingHistory(tenantId),
        };
    }

    async createCheckoutSession(userId: string, tenantId: string, dto: CreateCheckoutSessionDto) {
        const membership = await this.requireTenantMembership(userId, tenantId);
        this.assertBillingAccess(membership.role);

        if (dto.planCode === 'FREE') {
            const reference = `free_${tenantId.slice(0, 8)}_${Date.now()}`;
            const result = await this.applySubscriptionChange({
                tenantId,
                planCode: 'FREE',
                billingCycle: 'MONTHLY',
                status: 'ACTIVE',
                providerName: 'manual',
                providerCustomerRef: `tenant_${tenantId}`,
                providerSubscriptionRef: reference,
                cancelAtPeriodEnd: false,
            });

            await this.recordBillingEvent({
                tenantId,
                providerName: 'manual',
                externalEventId: reference,
                eventType: 'CHECKOUT_BYPASSED',
                status: 'ACTIVE',
                referenceId: reference,
                amount: 0,
                currency: 'BDT',
                payload: { reason: 'FREE_PLAN_SELECTED' },
            });

            return {
                provider_name: 'manual',
                reference,
                external_event_id: reference,
                checkout_url: null,
                billing_cycle: 'MONTHLY',
                amount: 0,
                currency: 'BDT',
                plan: result.subscription.plan,
                requires_confirmation: false,
                activated: true,
            };
        }

        const billingCycle = this.normalizeBillingCycle(dto.billingCycle);
        const plan = await this.getActivePlan(dto.planCode);
        const amount = billingCycle === 'YEARLY'
            ? Number(plan.yearly_price ?? Number(plan.monthly_price) * 12)
            : Number(plan.monthly_price);
        const providerName = this.getProviderName();
        const referencePrefix = providerName === 'ssl-wireless' ? 'sslw' : 'manual';
        const reference = `${referencePrefix}_${tenantId.slice(0, 8)}_${Date.now()}`;

        const checkout = providerName === 'ssl-wireless'
            ? await this.createSslWirelessCheckout({
                  tenantId,
                  userId,
                  tenantName: membership.tenant.name,
                  customerEmail: membership.user.email,
                  customerName: membership.user.name || membership.user.email,
                  reference,
                  billingCycle,
                  amount,
                  currency: 'BDT',
                  plan: this.mapPlan(plan),
              })
            : this.createManualCheckout({
                  tenantId,
                  reference,
                  billingCycle,
                  amount,
                  currency: 'BDT',
                  plan: this.mapPlan(plan),
              });

        await this.recordBillingEvent({
            tenantId,
            providerName: checkout.provider_name,
            externalEventId: checkout.external_event_id,
            eventType: 'CHECKOUT_CREATED',
            status: 'PENDING',
            referenceId: reference,
            amount,
            currency: 'BDT',
            payload: checkout.raw_payload,
        });

        return checkout;
    }

    async confirmCheckout(userId: string, tenantId: string, dto: ConfirmCheckoutDto) {
        const membership = await this.requireTenantMembership(userId, tenantId);
        this.assertBillingAccess(membership.role);

        return this.applySubscriptionChange({
            tenantId,
            planCode: dto.planCode,
            billingCycle: this.normalizeBillingCycle(dto.billingCycle),
            status: 'ACTIVE',
            providerName: 'manual',
            providerCustomerRef: `tenant_${tenantId}`,
            providerSubscriptionRef: dto.reference || `manual_${tenantId}_${Date.now()}`,
            cancelAtPeriodEnd: false,
        });
    }

    async cancelAtPeriodEnd(userId: string, tenantId: string) {
        const membership = await this.requireTenantMembership(userId, tenantId);
        this.assertBillingAccess(membership.role);

        const existing = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            include: { plan: true },
        });

        if (!existing) {
            throw new NotFoundException('No subscription found for this tenant.');
        }

        const subscription = await this.db.tenantSubscription.update({
            where: { tenant_id: tenantId },
            data: { cancel_at_period_end: true },
            include: { plan: true },
        });

        return this.mapSubscription(subscription);
    }

    async handleManualWebhook(signature: string | undefined, dto: ManualBillingWebhookDto) {
        const expectedSecret = process.env.BILLING_WEBHOOK_SECRET || 'dev-billing-webhook-secret';

        if (!signature || signature !== expectedSecret) {
            throw new UnauthorizedException('Invalid billing webhook secret');
        }

        const providerName = dto.providerName ?? 'manual';
        const externalEventId = dto.externalEventId
            ?? `${providerName}:${dto.providerSubscriptionRef ?? dto.tenantId}:${dto.status ?? 'ACTIVE'}`;

        const duplicate = await this.findProcessedBillingEvent(providerName, externalEventId);
        if (duplicate) {
            return this.buildWebhookReplayResponse(dto.tenantId, duplicate);
        }

        const result = await this.applySubscriptionChange({
            tenantId: dto.tenantId,
            planCode: dto.planCode,
            billingCycle: this.normalizeBillingCycle(dto.billingCycle),
            status: dto.status ?? 'ACTIVE',
            periodStart: dto.currentPeriodStart ? new Date(dto.currentPeriodStart) : undefined,
            periodEnd: dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : undefined,
            cancelAtPeriodEnd: dto.cancelAtPeriodEnd ?? false,
            providerName,
            providerCustomerRef: dto.providerCustomerRef ?? `tenant_${dto.tenantId}`,
            providerSubscriptionRef: dto.providerSubscriptionRef ?? `manual_${dto.tenantId}`,
        });

        await this.recordBillingEvent({
            tenantId: dto.tenantId,
            providerName,
            externalEventId,
            eventType: 'MANUAL_WEBHOOK',
            status: dto.status ?? 'ACTIVE',
            referenceId: dto.providerSubscriptionRef,
            payload: dto,
        });

        return result;
    }

    async processRefund(userId: string, tenantId: string, dto: RefundBillingDto) {
        const membership = await this.requireTenantMembership(userId, tenantId);
        this.assertBillingAccess(membership.role);

        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            include: { plan: true },
        });

        if (!subscription) {
            throw new NotFoundException('No subscription found for this tenant.');
        }

        const providerName = subscription.provider_name ?? 'manual';
        const externalEventId = dto.idempotencyKey ?? `refund:${dto.referenceId}`;
        const duplicate = await this.findProcessedBillingEvent(providerName, externalEventId);
        if (duplicate) {
            return {
                refunded: true,
                duplicate: true,
                reference_id: dto.referenceId,
                event_id: duplicate.id,
            };
        }

        const amount = dto.amount ?? Number(subscription.plan?.monthly_price ?? 0);
        const currency = dto.currency ?? 'BDT';

        await this.recordBillingEvent({
            tenantId,
            providerName,
            externalEventId,
            eventType: 'REFUND',
            status: 'COMPLETED',
            referenceId: dto.referenceId,
            amount,
            currency,
            payload: {
                reason: dto.reason ?? null,
                downgrade_to_free: dto.downgradeToFree ?? false,
            },
        });

        this.audit.log(
            'BILLING_REFUND',
            'BillingEvent',
            { tenantId },
            tenantId,
            { referenceId: dto.referenceId, amount, currency, reason: dto.reason ?? null },
        ).catch(() => {});

        if (dto.downgradeToFree) {
            await this.applySubscriptionChange({
                tenantId,
                planCode: 'FREE',
                billingCycle: 'MONTHLY',
                status: 'ACTIVE',
                providerName,
                providerSubscriptionRef: dto.referenceId,
                cancelAtPeriodEnd: false,
            });
        }

        return {
            refunded: true,
            duplicate: false,
            reference_id: dto.referenceId,
            amount,
            currency,
            downgraded: dto.downgradeToFree ?? false,
        };
    }

    async handleSslWirelessCallback(payload: BillingCallbackDto, mode: SslWirelessCallbackMode) {
        const reference = payload.tran_id;
        const tenantId = payload.value_a;
        const planCode = (payload.value_b as PlanCode | undefined) ?? 'BASIC';
        const billingCycle = this.normalizeBillingCycle(payload.value_c);

        if (!reference || !tenantId) {
            throw new BadRequestException('Missing SSL Wireless callback reference.');
        }

        if (mode === 'success' || mode === 'ipn') {
            if (payload.val_id) {
                const duplicate = await this.findProcessedBillingEvent('ssl-wireless', payload.val_id);
                if (duplicate) {
                    if (mode === 'ipn') {
                        return this.buildWebhookReplayResponse(tenantId, duplicate);
                    }

                    return this.buildFrontendBillingRedirect('success', {
                        reference,
                        planCode,
                        tenantId,
                        message: 'Payment already processed.',
                    });
                }
            }

            const validation = await this.validateSslWirelessTransaction(payload.val_id, reference);
            const providerStatus = String(validation.status || payload.status || '').toUpperCase();
            const externalEventId = validation.val_id || `${reference}:${providerStatus}`;
            const subscriptionStatus = this.mapSslWirelessStatusToSubscriptionStatus(providerStatus);
            const resolved = await this.applySubscriptionChange({
                tenantId,
                planCode,
                billingCycle,
                status: subscriptionStatus,
                providerName: 'ssl-wireless',
                providerCustomerRef: validation.value_a || tenantId,
                providerSubscriptionRef: validation.bank_tran_id || payload.val_id || reference,
            });

            await this.recordBillingEvent({
                tenantId,
                providerName: 'ssl-wireless',
                externalEventId,
                eventType: mode === 'ipn' ? 'IPN' : 'CALLBACK_SUCCESS',
                status: providerStatus,
                referenceId: reference,
                amount: Number(validation.amount || payload.amount || 0),
                currency: validation.currency || payload.currency || 'BDT',
                payload: { callback: payload, validation },
            });

            if (mode === 'ipn') {
                return resolved;
            }

            return this.buildFrontendBillingRedirect('success', {
                reference,
                planCode,
                tenantId,
                message: 'Payment verified successfully.',
            });
        }

        const providerStatus = mode === 'cancel' ? 'CANCELLED' : 'FAILED';
        await this.applySubscriptionChange({
            tenantId,
            planCode,
            billingCycle,
            status: this.mapSslWirelessStatusToSubscriptionStatus(providerStatus),
            providerName: 'ssl-wireless',
            providerSubscriptionRef: reference,
        });
        await this.recordBillingEvent({
            tenantId,
            providerName: 'ssl-wireless',
            externalEventId: `${reference}:${providerStatus}`,
            eventType: mode === 'cancel' ? 'CALLBACK_CANCEL' : 'CALLBACK_FAIL',
            status: providerStatus,
            referenceId: reference,
            amount: Number(payload.amount || 0),
            currency: payload.currency || 'BDT',
            payload,
        });

        return this.buildFrontendBillingRedirect(mode === 'cancel' ? 'cancel' : 'failed', {
            reference,
            planCode,
            tenantId,
            message: mode === 'cancel' ? 'Payment was cancelled.' : 'Payment failed verification.',
        });
    }

    async applySubscriptionChange(input: {
        tenantId: string;
        planCode: PlanCode;
        billingCycle?: BillingCycle;
        status?: SubscriptionStatus;
        periodStart?: Date;
        periodEnd?: Date;
        cancelAtPeriodEnd?: boolean;
        providerName?: string;
        providerCustomerRef?: string;
        providerSubscriptionRef?: string;
    }) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: input.tenantId },
            select: { id: true, name: true },
        });

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        const plan = await this.getActivePlan(input.planCode);
        const billingCycle = this.normalizeBillingCycle(input.billingCycle);
        const periodStart = input.periodStart ?? new Date();
        const periodEnd = input.periodEnd ?? this.calculatePeriodEnd(periodStart, billingCycle);

        const subscription = await this.db.tenantSubscription.upsert({
            where: { tenant_id: input.tenantId },
            update: {
                plan_id: plan.id,
                status: input.status ?? 'ACTIVE',
                current_period_start: periodStart,
                current_period_end: periodEnd,
                cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
                provider_name: input.providerName ?? 'manual',
                provider_customer_ref: input.providerCustomerRef ?? `tenant_${input.tenantId}`,
                provider_subscription_ref: input.providerSubscriptionRef ?? `manual_${input.tenantId}`,
            },
            create: {
                tenant_id: input.tenantId,
                plan_id: plan.id,
                status: input.status ?? 'ACTIVE',
                current_period_start: periodStart,
                current_period_end: periodEnd,
                cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
                provider_name: input.providerName ?? 'manual',
                provider_customer_ref: input.providerCustomerRef ?? `tenant_${input.tenantId}`,
                provider_subscription_ref: input.providerSubscriptionRef ?? `manual_${input.tenantId}`,
            },
            include: { plan: true },
        });

        this.audit.log(
            'SUBSCRIPTION_CHANGED',
            'TenantSubscription',
            { tenantId: input.tenantId },
            input.tenantId,
            { planCode: input.planCode, status: input.status ?? 'ACTIVE', providerName: input.providerName },
        ).catch(() => {});

        const resolvedStatus = input.status ?? 'ACTIVE';
        if (resolvedStatus === 'ACTIVE' || resolvedStatus === 'PAST_DUE') {
            const emailAmount = billingCycle === 'YEARLY'
                ? Number(plan.yearly_price ?? Number(plan.monthly_price) * 12)
                : Number(plan.monthly_price);

            if (emailAmount > 0) {
                this.notifyTenantOwner(input.tenantId, resolvedStatus, {
                    tenantName: tenant.name,
                    amount: emailAmount,
                    currency: 'BDT',
                }).catch(() => {});
            }
        }

        return {
            tenant,
            subscription: this.mapSubscription(subscription),
        };
    }

    private async notifyTenantOwner(
        tenantId: string,
        status: 'ACTIVE' | 'PAST_DUE',
        context: { tenantName: string; amount: number; currency: string },
    ) {
        const ownerMembership = await this.db.tenantUser.findFirst({
            where: { tenant_id: tenantId, role: 'OWNER' },
            include: { user: { select: { email: true } } },
        });

        if (!ownerMembership?.user?.email) return;

        if (status === 'ACTIVE') {
            await this.email.sendBillingInvoice(
                ownerMembership.user.email,
                context.tenantName,
                context.amount,
                context.currency,
            );
        } else {
            await this.email.sendPaymentFailure(
                ownerMembership.user.email,
                context.tenantName,
                context.amount,
                context.currency,
            );
        }
    }

    private async getBillingHistory(tenantId: string) {
        const events = await this.db.billingEvent.findMany({
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
            take: 10,
        });

        return events.map((event) => ({
            id: event.id,
            provider_name: event.provider_name,
            event_type: event.event_type,
            status: event.status,
            reference_id: event.reference_id,
            amount: event.amount === null ? null : Number(event.amount),
            currency: event.currency,
            created_at: event.created_at,
        }));
    }

    private getProviderName(): BillingProviderName {
        const configuredProvider = process.env.BILLING_PROVIDER?.trim().toUpperCase();
        if (configuredProvider === 'SSL_WIRELESS' || configuredProvider === 'SSLCOMMERZ') {
            return 'ssl-wireless';
        }

        if (process.env.SSL_WIRELESS_STORE_ID && process.env.SSL_WIRELESS_STORE_PASSWORD) {
            return 'ssl-wireless';
        }

        return 'manual';
    }

    private createManualCheckout(input: {
        tenantId: string;
        reference: string;
        billingCycle: BillingCycle;
        amount: number;
        currency: string;
        plan: ReturnType<BillingService['mapPlan']>;
    }) {
        const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const checkoutUrl = `${frontendBaseUrl}/dashboard/billing?reference=${encodeURIComponent(input.reference)}&plan=${input.plan.code}&cycle=${input.billingCycle.toLowerCase()}`;

        return {
            provider_name: 'manual',
            reference: input.reference,
            external_event_id: input.reference,
            checkout_url: checkoutUrl,
            billing_cycle: input.billingCycle,
            amount: input.amount,
            currency: input.currency,
            plan: input.plan,
            requires_confirmation: true,
            raw_payload: {
                mode: 'manual',
                tenantId: input.tenantId,
                reference: input.reference,
            },
            webhook_example: {
                endpoint: '/billing/webhooks/manual',
                required_header: 'x-billing-webhook-secret',
                payload: {
                    tenantId: input.tenantId,
                    planCode: input.plan.code,
                    status: 'ACTIVE',
                    billingCycle: input.billingCycle,
                    providerName: 'manual',
                    providerCustomerRef: `tenant_${input.tenantId}`,
                    providerSubscriptionRef: input.reference,
                },
            },
        };
    }

    private async createSslWirelessCheckout(input: {
        tenantId: string;
        userId: string;
        tenantName: string;
        customerEmail: string;
        customerName: string;
        reference: string;
        billingCycle: BillingCycle;
        amount: number;
        currency: string;
        plan: ReturnType<BillingService['mapPlan']>;
    }) {
        const apiUrl = process.env.SSL_WIRELESS_API_URL || 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
        const storeId = process.env.SSL_WIRELESS_STORE_ID;
        const storePassword = process.env.SSL_WIRELESS_STORE_PASSWORD;
        const backendPublicUrl = process.env.BACKEND_PUBLIC_URL || 'http://localhost:4000';

        if (!storeId || !storePassword) {
            throw new BadRequestException('SSL Wireless credentials are not configured.');
        }

        const body = new URLSearchParams({
            store_id: storeId,
            store_passwd: storePassword,
            total_amount: input.amount.toFixed(2),
            currency: input.currency,
            tran_id: input.reference,
            success_url: `${backendPublicUrl}/billing/callbacks/ssl-wireless/success`,
            fail_url: `${backendPublicUrl}/billing/callbacks/ssl-wireless/fail`,
            cancel_url: `${backendPublicUrl}/billing/callbacks/ssl-wireless/cancel`,
            ipn_url: `${backendPublicUrl}/billing/webhooks/ssl-wireless`,
            cus_name: input.customerName,
            cus_email: input.customerEmail,
            cus_add1: input.tenantName,
            cus_city: 'Dhaka',
            cus_country: 'Bangladesh',
            shipping_method: 'NO',
            product_name: `${input.plan.name} Subscription`,
            product_category: 'SaaS Subscription',
            product_profile: 'general',
            value_a: input.tenantId,
            value_b: input.plan.code,
            value_c: input.billingCycle,
            value_d: input.userId,
        });

        const response = await this.callSslWireless('sslcommerz-checkout', () =>
            fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body.toString(),
            }),
        );
        const payload = await this.parseJsonResponse(response);

        if (!response.ok || !payload.GatewayPageURL) {
            throw new InternalServerErrorException(payload.failedreason || 'SSL Wireless checkout initialization failed.');
        }

        return {
            provider_name: 'ssl-wireless',
            reference: input.reference,
            external_event_id: payload.sessionkey || input.reference,
            checkout_url: payload.GatewayPageURL,
            billing_cycle: input.billingCycle,
            amount: input.amount,
            currency: input.currency,
            plan: input.plan,
            requires_confirmation: false,
            raw_payload: payload,
        };
    }

    /**
     * Runs an SSL Wireless HTTP call under a circuit breaker (10s timeout). When
     * the circuit is open we fail fast with a 503 instead of hammering a dead
     * gateway; underlying network errors propagate unchanged.
     */
    private async callSslWireless(breaker: string, fn: () => Promise<Response>): Promise<Response> {
        try {
            return await this.breakers.get(breaker, { timeoutMs: 10_000 }).execute(fn);
        } catch (err) {
            if (err instanceof CircuitOpenError) {
                throw new ServiceUnavailableException('Payment gateway is temporarily unavailable. Please try again shortly.');
            }
            throw err;
        }
    }

    private async validateSslWirelessTransaction(valId: string | undefined, reference: string) {
        if (!valId) {
            throw new BadRequestException('SSL Wireless validation id is missing.');
        }

        const validationUrl = process.env.SSL_WIRELESS_VALIDATION_URL || 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';
        const storeId = process.env.SSL_WIRELESS_STORE_ID;
        const storePassword = process.env.SSL_WIRELESS_STORE_PASSWORD;

        if (!storeId || !storePassword) {
            throw new BadRequestException('SSL Wireless credentials are not configured.');
        }

        const url = new URL(validationUrl);
        url.searchParams.set('val_id', valId);
        url.searchParams.set('store_id', storeId);
        url.searchParams.set('store_passwd', storePassword);
        url.searchParams.set('format', 'json');

        const response = await this.callSslWireless('sslcommerz-validate', () =>
            fetch(url.toString(), { method: 'GET' }),
        );
        const payload = await this.parseJsonResponse(response);

        if (!response.ok) {
            const error = new InternalServerErrorException('Failed to validate SSL Wireless payment.');
            Sentry.captureException(error, { tags: { domain: 'payment', provider: 'ssl-wireless' } });
            throw error;
        }

        if (payload.tran_id && payload.tran_id !== reference) {
            throw new BadRequestException('SSL Wireless transaction reference mismatch.');
        }

        return payload;
    }

    private async findProcessedBillingEvent(providerName: string, externalEventId: string) {
        const existing = await this.db.billingEvent.findUnique({
            where: {
                provider_name_external_event_id: {
                    provider_name: providerName,
                    external_event_id: externalEventId,
                },
            },
        });

        if (!existing) {
            return null;
        }

        const processedTypes = new Set([
            'IPN',
            'CALLBACK_SUCCESS',
            'MANUAL_WEBHOOK',
            'REFUND',
            'CHECKOUT_CONFIRMED',
        ]);
        const processedStatuses = new Set([
            'VALID',
            'VALIDATED',
            'ACTIVE',
            'SUCCESS',
            'COMPLETED',
        ]);

        if (processedTypes.has(existing.event_type) && processedStatuses.has(existing.status)) {
            return existing;
        }

        return null;
    }

    private async buildWebhookReplayResponse(tenantId: string, event: { tenant_id: string }) {
        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            include: { plan: true },
        });

        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true },
        });

        return {
            tenant,
            subscription: subscription ? this.mapSubscription(subscription) : null,
            idempotent_replay: true,
            replayed_event_tenant_id: event.tenant_id,
        };
    }

    private async recordBillingEvent(input: {
        tenantId: string;
        providerName: string;
        externalEventId: string;
        eventType: string;
        status: string;
        referenceId?: string;
        amount?: number;
        currency?: string;
        payload: unknown;
    }) {
        if (!input.externalEventId) {
            return null;
        }

        return this.db.billingEvent.upsert({
            where: {
                provider_name_external_event_id: {
                    provider_name: input.providerName,
                    external_event_id: input.externalEventId,
                },
            },
            update: {
                status: input.status,
                event_type: input.eventType,
                reference_id: input.referenceId,
                amount: input.amount,
                currency: input.currency,
                payload: input.payload as any,
            },
            create: {
                tenant_id: input.tenantId,
                provider_name: input.providerName,
                external_event_id: input.externalEventId,
                event_type: input.eventType,
                status: input.status,
                reference_id: input.referenceId,
                amount: input.amount,
                currency: input.currency,
                payload: input.payload as any,
            },
        });
    }

    private mapSslWirelessStatusToSubscriptionStatus(status: string): SubscriptionStatus {
        switch (status) {
            case 'VALID':
            case 'VALIDATED':
                return 'ACTIVE';
            case 'CANCELLED':
            case 'CANCELED':
                return 'CANCELLED';
            case 'FAILED':
            case 'FAILED/CANCELLED':
            case 'INVALID_TRANSACTION':
                return 'PAST_DUE';
            default:
                return 'TRIALING';
        }
    }

    private buildFrontendBillingRedirect(
        paymentStatus: 'success' | 'failed' | 'cancel',
        input: { reference: string; planCode: string; tenantId: string; message: string },
    ) {
        const frontendRedirect = paymentStatus === 'success'
            ? process.env.SSL_WIRELESS_SUCCESS_REDIRECT
            : paymentStatus === 'failed'
                ? process.env.SSL_WIRELESS_FAIL_REDIRECT
                : process.env.SSL_WIRELESS_CANCEL_REDIRECT;
        const baseUrl = frontendRedirect || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/billing`;
        const url = new URL(baseUrl);
        url.searchParams.set('paymentStatus', paymentStatus);
        url.searchParams.set('reference', input.reference);
        url.searchParams.set('plan', input.planCode);
        url.searchParams.set('tenantId', input.tenantId);
        url.searchParams.set('message', input.message);
        return url.toString();
    }

    private async parseJsonResponse(response: Response) {
        const raw = await response.text();

        try {
            return JSON.parse(raw || '{}');
        } catch {
            throw new InternalServerErrorException('Payment gateway returned an unreadable response.');
        }
    }

    private async requireTenantMembership(userId: string, tenantId: string) {
        const membership = await this.db.tenantUser.findUnique({
            where: {
                tenant_id_user_id: {
                    tenant_id: tenantId,
                    user_id: userId,
                },
            },
            include: {
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
        });

        if (!membership) {
            throw new UnauthorizedException('Invalid tenant context');
        }

        return membership;
    }

    private async getActivePlan(planCode: PlanCode) {
        const plan = await this.db.subscriptionPlan.findUnique({
            where: { code: planCode },
        });

        if (!plan || !plan.is_active) {
            throw new BadRequestException('Selected plan is not available');
        }

        return plan;
    }

    private normalizeBillingCycle(billingCycle?: string): BillingCycle {
        return billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
    }

    private calculatePeriodEnd(periodStart: Date, billingCycle: BillingCycle) {
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + (billingCycle === 'YEARLY' ? 365 : 30));
        return periodEnd;
    }

    private canManageBilling(role: string) {
        return role === 'OWNER' || role === 'MANAGER';
    }

    private assertBillingAccess(role: string) {
        if (!this.canManageBilling(role)) {
            throw new ForbiddenException('Only tenant owners and managers can manage billing.');
        }
    }

    private mapPlan(plan: {
        code: PlanCode;
        name: string;
        description: string | null;
        monthly_price: unknown;
        yearly_price: unknown;
        features_json: unknown;
    }) {
        return {
            code: plan.code,
            name: plan.name,
            description: plan.description,
            monthly_price: Number(plan.monthly_price),
            yearly_price: plan.yearly_price === null ? null : Number(plan.yearly_price),
            features_json: plan.features_json,
        };
    }

    private mapSubscription(subscription: any) {
        if (!subscription) {
            return null;
        }

        return {
            status: subscription.status,
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            provider_name: subscription.provider_name,
            provider_customer_ref: subscription.provider_customer_ref,
            provider_subscription_ref: subscription.provider_subscription_ref,
            is_premium: subscription.plan?.code === 'PREMIUM',
            is_paid_plan: subscription.plan?.code !== 'FREE',
            plan: subscription.plan ? this.mapPlan(subscription.plan) : null,
        };
    }
}