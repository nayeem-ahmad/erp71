import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { TenantContext } from '../database/tenant.decorator';
import { hasStorePermission } from '../auth/permission.util';
import { StorePermission } from '@erp71/shared-types';
import { isPendingActivation } from '../billing/activation-state.util';
import {
    ACTIVATION_PAYMENT_METHODS,
    CreateActivationRequestDto,
    RejectActivationRequestDto,
    ReviewActivationRequestDto,
} from './activation.dto';

type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

/**
 * Manual activation, for the window before a payment gateway is live.
 *
 * Signup provisions a workspace unpaid; this is the path from there to a working
 * one. The tenant is shown what they owe and the team's bKash/Nagad numbers,
 * sends the money themselves, and submits the transaction ID. A platform admin
 * checks it against the merchant app and approves, which is the step that posts
 * the payment to the ledger and switches the workspace on.
 *
 * Nothing a tenant does here grants access. A submitted request is a claim, not
 * a payment: only `approve` touches the subscription, and only an admin can call
 * it.
 */
@Injectable()
export class ActivationService {
    private readonly logger = new Logger(ActivationService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly email: EmailService,
        private readonly audit: AuditService,
        private readonly billing: BillingService,
        private readonly settings: PlatformSettingsService,
    ) {}

    /**
     * What the activation screen renders: whether the workspace is still waiting,
     * what it costs, where to send the money, and how the last submission went.
     *
     * Readable by any member, not just whoever holds billing permission. A
     * cashier who cannot open a locked module deserves to be told the workspace
     * is awaiting activation rather than shown a permission error — only
     * *submitting* is gated.
     */
    async getStatus(ctx: TenantContext) {
        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: ctx.tenantId },
            include: { plan: true },
        });

        const pending = isPendingActivation(subscription);
        const [latestRequest, instructions, canSubmit] = await Promise.all([
            this.findLatestRequest(ctx.tenantId),
            this.getPaymentInstructions(),
            this.canManageBilling(ctx),
        ]);

        // Only quote a price while there is something to buy. Once activated the
        // screen is gone, and pricing a plan the tenant already holds would put
        // a "you owe ৳2,000" figure in front of someone who owes nothing.
        const quote = pending && subscription?.plan
            ? await this.quoteFor(ctx.tenantId, subscription.plan.code as PlanCode, subscription.billing_cycle)
            : null;

        return {
            pending_activation: pending,
            can_submit: canSubmit,
            subscription_status: subscription?.status ?? null,
            plan: subscription?.plan
                ? {
                      code: subscription.plan.code,
                      name: subscription.plan.name,
                  }
                : null,
            billing_cycle: subscription?.billing_cycle ?? 'MONTHLY',
            amount_due: quote?.amount ?? null,
            setup_fee: quote?.setupFee ?? null,
            currency: 'BDT',
            instructions,
            latest_request: latestRequest ? this.mapRequest(latestRequest) : null,
        };
    }

    /**
     * Record a tenant's claim that they have paid.
     *
     * Deliberately does not touch the subscription. The whole point of the manual
     * window is that money arrives out of band and a human confirms it; a tenant
     * who could activate by typing a plausible TrxID would make the whole check
     * theatre.
     */
    async submitRequest(ctx: TenantContext, dto: CreateActivationRequestDto) {
        await this.assertBillingAccess(ctx);

        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: ctx.tenantId },
            include: { plan: true },
        });

        if (!isPendingActivation(subscription)) {
            throw new ConflictException('This workspace is already activated.');
        }
        if (!subscription?.plan) {
            throw new BadRequestException('No plan is selected for this workspace yet.');
        }

        const existingPending = await this.db.activationRequest.findFirst({
            where: { tenant_id: ctx.tenantId, status: 'PENDING' },
        });
        if (existingPending) {
            throw new ConflictException(
                'You already have a payment awaiting verification. Our team will confirm it shortly.',
            );
        }

        const transactionId = dto.transactionId.trim().toUpperCase();

        let request;
        try {
            request = await this.db.activationRequest.create({
                data: {
                    tenant_id: ctx.tenantId,
                    submitted_by: ctx.userId,
                    method: dto.method,
                    transaction_id: transactionId,
                    sender_number: dto.senderNumber?.trim() || null,
                    amount: new Prisma.Decimal(dto.amount),
                    note: dto.note?.trim() || null,
                    plan_code: subscription.plan.code,
                    billing_cycle: subscription.billing_cycle,
                },
            });
        } catch (err) {
            // The unique index on (method, transaction_id) is the real guarantee
            // that one receipt activates one workspace. Translated here because
            // P2002 tells the owner nothing they can act on.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw new ConflictException(
                    'That transaction ID has already been submitted. Check the ID, or contact support if you think this is a mistake.',
                );
            }
            throw err;
        }

        this.audit
            .log('ACTIVATION_REQUEST_SUBMITTED', 'ActivationRequest', { userId: ctx.userId, tenantId: ctx.tenantId }, request.id, {
                method: request.method,
                amount: Number(request.amount),
            })
            .catch(() => {});

        await this.notifyTeamOfRequest(ctx.tenantId, request);
        await this.notifyTenantOfSubmission(ctx.tenantId, request);

        return this.mapRequest(request);
    }

    // ── Admin side ─────────────────────────────────────────────────────────────

    async listRequests(status?: 'PENDING' | 'VERIFIED' | 'REJECTED') {
        const rows = await this.db.activationRequest.findMany({
            where: status ? { status } : undefined,
            orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
            take: 200,
            include: {
                tenant: {
                    select: {
                        id: true,
                        name: true,
                        subscription: { select: { status: true, plan: { select: { code: true, name: true } } } },
                    },
                },
            },
        });

        const submitters = await this.db.user.findMany({
            where: { id: { in: [...new Set(rows.map((row) => row.submitted_by))] } },
            select: { id: true, name: true, email: true, mobile: true },
        });
        const byId = new Map(submitters.map((user) => [user.id, user]));

        return rows.map((row) => ({
            ...this.mapRequest(row),
            tenant: { id: row.tenant.id, name: row.tenant.name },
            tenant_plan: row.tenant.subscription?.plan?.name ?? null,
            tenant_subscription_status: row.tenant.subscription?.status ?? null,
            submitted_by: byId.get(row.submitted_by)
                ? {
                      name: byId.get(row.submitted_by)!.name,
                      email: byId.get(row.submitted_by)!.email,
                      mobile: byId.get(row.submitted_by)!.mobile,
                  }
                : null,
        }));
    }

    /**
     * Confirm the money arrived: post it to the ledger and switch the workspace on.
     *
     * The amount that reaches the ledger is the admin's, not the tenant's —
     * `dto.amount` overrides the claim, because what was actually received is
     * what the books have to say. The subscription is moved through
     * `applySubscriptionChange` rather than a status update so the tenant gets a
     * real billing period; settling a zero-length one would leave the renewal job
     * with a period that ended before it began.
     */
    async approve(requestId: string, adminUserId: string, dto: ReviewActivationRequestDto) {
        const request = await this.db.activationRequest.findUnique({
            where: { id: requestId },
            include: { tenant: { select: { id: true, name: true } } },
        });
        if (!request) throw new NotFoundException('Activation request not found');
        if (request.status !== 'PENDING') {
            throw new ConflictException(`This request was already ${request.status.toLowerCase()}.`);
        }

        const amount = dto.amount ?? Number(request.amount);

        const updated = await this.db.activationRequest.updateMany({
            where: { id: requestId, status: 'PENDING' },
            data: {
                status: 'VERIFIED',
                reviewed_by: adminUserId,
                reviewed_at: new Date(),
                review_note: dto.note?.trim() || null,
                amount: new Prisma.Decimal(amount),
            },
        });
        // Two admins clicking approve on the same queue must not both post a
        // payment. The status filter makes the transition the lock.
        if (updated.count === 0) {
            throw new ConflictException('This request was just reviewed by someone else.');
        }

        await this.db.billingEvent.create({
            data: {
                tenant_id: request.tenant_id,
                provider_name: request.method.toLowerCase(),
                external_event_id: `activation_${request.id}`,
                event_type: 'manual_payment',
                status: 'succeeded',
                reference_id: request.transaction_id,
                amount: new Prisma.Decimal(amount),
                currency: 'BDT',
                payload: {
                    activation_request_id: request.id,
                    method: request.method,
                    transaction_id: request.transaction_id,
                    sender_number: request.sender_number,
                    approved_by: adminUserId,
                    notes: dto.note?.trim() || null,
                },
            },
        });

        await this.billing.applySubscriptionChange({
            tenantId: request.tenant_id,
            planCode: request.plan_code as PlanCode,
            billingCycle: request.billing_cycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
            status: 'ACTIVE',
            periodStart: new Date(),
            cancelAtPeriodEnd: false,
            providerName: request.method.toLowerCase(),
            providerSubscriptionRef: `activation_${request.id}`,
        });

        this.audit
            .log('ACTIVATION_REQUEST_APPROVED', 'ActivationRequest', { userId: adminUserId, tenantId: request.tenant_id }, request.id, {
                amount,
                method: request.method,
                transaction_id: request.transaction_id,
            })
            .catch(() => {});

        await this.notifyTenantOfDecision(request.tenant_id, request.tenant.name, 'VERIFIED', null);

        return { id: request.id, status: 'VERIFIED' as const, amount };
    }

    async reject(requestId: string, adminUserId: string, dto: RejectActivationRequestDto) {
        const request = await this.db.activationRequest.findUnique({
            where: { id: requestId },
            include: { tenant: { select: { id: true, name: true } } },
        });
        if (!request) throw new NotFoundException('Activation request not found');
        if (request.status !== 'PENDING') {
            throw new ConflictException(`This request was already ${request.status.toLowerCase()}.`);
        }

        const updated = await this.db.activationRequest.updateMany({
            where: { id: requestId, status: 'PENDING' },
            data: {
                status: 'REJECTED',
                reviewed_by: adminUserId,
                reviewed_at: new Date(),
                review_note: dto.reason.trim(),
            },
        });
        if (updated.count === 0) {
            throw new ConflictException('This request was just reviewed by someone else.');
        }

        this.audit
            .log('ACTIVATION_REQUEST_REJECTED', 'ActivationRequest', { userId: adminUserId, tenantId: request.tenant_id }, request.id, {
                reason: dto.reason.trim(),
            })
            .catch(() => {});

        await this.notifyTenantOfDecision(request.tenant_id, request.tenant.name, 'REJECTED', dto.reason.trim());

        return { id: request.id, status: 'REJECTED' as const };
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    /**
     * The team's own payment details, as the activation screen shows them.
     *
     * Every field is optional and the screen degrades to "call us" when nothing
     * is configured — a deploy that has not had the numbers entered yet must
     * still render something a customer can act on, not a blank panel.
     */
    async getPaymentInstructions() {
        const group = await this.settings.getGroup('activation').catch(() => ({} as Record<string, string | null>));
        const value = (key: string) => {
            const raw = group[key];
            return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
        };

        const slaHours = Number(value('sla_hours') ?? '24');

        return {
            methods: ACTIVATION_PAYMENT_METHODS.filter((method) => {
                if (method === 'BKASH') return Boolean(value('bkash_number'));
                if (method === 'NAGAD') return Boolean(value('nagad_number'));
                return Boolean(value('bank_details'));
            }),
            bkash_number: value('bkash_number'),
            nagad_number: value('nagad_number'),
            bank_details: value('bank_details'),
            support_phone: value('support_phone'),
            support_whatsapp: value('support_whatsapp'),
            sla_hours: Number.isFinite(slaHours) && slaHours > 0 ? Math.round(slaHours) : 24,
            extra_instructions: value('instructions'),
        };
    }

    private async quoteFor(tenantId: string, planCode: PlanCode, billingCycle: string) {
        try {
            return await this.billing.quoteSubscriptionAmount({
                tenantId,
                planCode,
                billingCycle: billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
            });
        } catch (err) {
            // A deactivated or mispriced plan must not blank the whole screen:
            // the payment details and the support number are still useful, and
            // the amount is something the team can quote on the phone.
            this.logger.warn(`Could not quote activation amount for tenant ${tenantId}: ${(err as Error)?.message}`);
            return null;
        }
    }

    private findLatestRequest(tenantId: string) {
        return this.db.activationRequest.findFirst({
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
        });
    }

    private mapRequest(row: {
        id: string;
        method: string;
        transaction_id: string;
        sender_number: string | null;
        amount: Prisma.Decimal | number;
        note: string | null;
        status: string;
        plan_code: string;
        billing_cycle: string;
        review_note: string | null;
        reviewed_at: Date | null;
        created_at: Date;
    }) {
        return {
            id: row.id,
            method: row.method,
            transaction_id: row.transaction_id,
            sender_number: row.sender_number,
            amount: Number(row.amount),
            note: row.note,
            status: row.status,
            plan_code: row.plan_code,
            billing_cycle: row.billing_cycle,
            review_note: row.review_note,
            reviewed_at: row.reviewed_at,
            created_at: row.created_at,
        };
    }

    private async canManageBilling(ctx: TenantContext): Promise<boolean> {
        return hasStorePermission(this.db, ctx, StorePermission.MANAGE_USERS);
    }

    private async assertBillingAccess(ctx: TenantContext): Promise<void> {
        if (!(await this.canManageBilling(ctx))) {
            throw new ForbiddenException('You do not have permission to manage billing for this workspace.');
        }
    }

    private async notifyTeamOfRequest(tenantId: string, request: { id: string; method: string; transaction_id: string; sender_number: string | null; amount: Prisma.Decimal | number }) {
        const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        const frontendUrl = await this.email.getFrontendUrl().catch(() => '');

        await this.email
            .sendActivationRequestAlert({
                tenantName: tenant?.name ?? tenantId,
                method: request.method,
                transactionId: request.transaction_id,
                senderNumber: request.sender_number,
                amount: Number(request.amount),
                reviewUrl: frontendUrl ? `${frontendUrl}/admin/activation-requests` : null,
            })
            .catch((err) => this.logger.warn(`Activation request alert failed: ${err?.message}`));
    }

    private async notifyTenantOfSubmission(tenantId: string, request: { transaction_id: string; amount: Prisma.Decimal | number }) {
        const owner = await this.findOwnerEmail(tenantId);
        if (!owner) return;
        const { sla_hours: slaHours } = await this.getPaymentInstructions();

        await this.email
            .sendActivationPaymentReceived(owner.email, {
                tenantName: owner.tenantName,
                transactionId: request.transaction_id,
                amount: Number(request.amount),
                slaHours,
            })
            .catch((err) => this.logger.warn(`Activation submission email failed: ${err?.message}`));
    }

    private async notifyTenantOfDecision(
        tenantId: string,
        tenantName: string,
        outcome: 'VERIFIED' | 'REJECTED',
        reason: string | null,
    ) {
        const owner = await this.findOwnerEmail(tenantId);
        if (!owner) return;

        const send = outcome === 'VERIFIED'
            ? this.email.sendWorkspaceActivated(owner.email, tenantName)
            : this.email.sendActivationRequestRejected(owner.email, tenantName, reason ?? '');

        await send.catch((err) => this.logger.warn(`Activation decision email failed: ${err?.message}`));
    }

    private async findOwnerEmail(tenantId: string) {
        const ownerMembership = await this.db.tenantUser.findFirst({
            where: { tenant_id: tenantId, role: 'OWNER' },
            include: {
                user: { select: { email: true } },
                tenant: { select: { name: true } },
            },
        });
        if (!ownerMembership?.user?.email) return null;
        return { email: ownerMembership.user.email, tenantName: ownerMembership.tenant.name };
    }
}
