import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePermission } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant.decorator';
import { hasStorePermission } from '../auth/permission.util';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { SupportEventsService } from '../support/support-events.service';
import { SmsCreditService } from '../sms/sms-credit.service';
import {
    CHANNEL_LABEL,
    CHANNEL_SALE_EVENT_TYPE,
    isMessagingChannel,
    MESSAGING_CHANNELS,
    type MessagingChannel,
} from '../sms/messaging-channel';
import type {
    ApproveCreditTopupRequestDto,
    CreateCreditPackageDto,
    CreateCreditTopupRequestDto,
    CreditTopupStatus,
    RejectCreditTopupRequestDto,
    UpdateCreditPackageDto,
} from './credit-topup.dto';

/** Below this a balance is flagged as running low on the credits screen. */
const LOW_BALANCE_THRESHOLD = 20;

/**
 * How many unverified top-ups a shop may have open at once. Enough to buy a
 * package on every channel and make one mistake; more is a queue an admin has
 * to wade through, and nothing is granted until each is checked anyway.
 */
const MAX_PENDING_PER_TENANT = 5;

type RequestRow = Prisma.CreditTopupRequestGetPayload<{
    include: { supportThread: { select: { ticketNumber: true } } };
}>;

/**
 * Buying SMS, WhatsApp and email credits while no gateway is live.
 *
 * The shop picks a package, sends its price to the team's bKash number, and
 * submits the TrxID. That opens a support ticket so the request lands in the
 * admin inbox. A platform admin finds the payment in the bKash app and
 * approves, which is the only step that adds credits — and the PENDING →
 * APPROVED transition happens in the same transaction as the grant, so two
 * admins approving at once cannot both grant.
 *
 * Nothing a tenant does here adds a credit. This replaces a "Buy" button that
 * granted credits on click with no payment behind it.
 */
@Injectable()
export class CreditTopupService {
    private readonly logger = new Logger(CreditTopupService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly credits: SmsCreditService,
        private readonly settings: PlatformSettingsService,
        private readonly email: EmailService,
        private readonly audit: AuditService,
        private readonly supportEvents: SupportEventsService,
    ) {}

    // ── Tenant side ────────────────────────────────────────────────────────────

    /**
     * What the credits screen renders: every balance, what can be bought, where
     * to pay, and how the shop's recent top-ups went. Readable by any member —
     * a cashier deserves to see why receipts stopped going out — and only
     * submitting is gated.
     */
    async getSummary(ctx: TenantContext) {
        const membership = await this.requireTenantMembership(ctx);
        const [tenant, balances, packages, transactions, requests, payment, canManage] = await Promise.all([
            this.db.tenant.findUnique({
                where: { id: ctx.tenantId },
                select: { id: true, name: true, sms_enabled: true },
            }),
            this.credits.getBalances(ctx.tenantId),
            this.credits.listActivePackages(),
            this.credits.listTransactions(ctx.tenantId),
            this.db.creditTopupRequest.findMany({
                where: { tenant_id: ctx.tenantId },
                orderBy: { created_at: 'desc' },
                take: 10,
                include: { supportThread: { select: { ticketNumber: true } } },
            }),
            this.getPaymentInstructions(),
            this.canManageBilling(ctx),
        ]);

        if (!tenant) throw new NotFoundException('Tenant not found');

        const lowBalance = Object.fromEntries(
            MESSAGING_CHANNELS.map((channel) => [channel, balances[channel] < LOW_BALANCE_THRESHOLD]),
        ) as Record<MessagingChannel, boolean>;

        return {
            tenant: { id: tenant.id, name: tenant.name },
            role: membership.role,
            can_manage_billing: canManage,
            sms_enabled: tenant.sms_enabled,
            balances,
            low_balance: lowBalance,
            packages,
            transactions,
            requests: requests.map((row) => this.mapRequest(row)),
            payment,
        };
    }

    /**
     * Record a shop's claim that it has paid for a package. Deliberately grants
     * nothing: the claim is what an admin checks against the bKash app.
     */
    async submitRequest(ctx: TenantContext, dto: CreateCreditTopupRequestDto) {
        await this.requireTenantMembership(ctx);
        await this.assertBillingAccess(ctx);

        const pkg = await this.credits.getActivePackage(dto.packageId);
        if (!isMessagingChannel(pkg.channel)) {
            throw new BadRequestException('Selected credit package is not available.');
        }
        const channel = pkg.channel;
        const transactionId = normalizeTransactionId(dto.transactionId);
        const senderNumber = dto.senderNumber.trim();
        const note = dto.note?.trim() || null;

        const pendingCount = await this.db.creditTopupRequest.count({
            where: { tenant_id: ctx.tenantId, status: 'PENDING' },
        });
        if (pendingCount >= MAX_PENDING_PER_TENANT) {
            throw new ConflictException(
                `You already have ${pendingCount} top-ups awaiting verification. Our team will confirm them shortly.`,
            );
        }

        // A TrxID is one payment. The unique index stops it buying two packages;
        // this stops the same receipt also being claimed for a workspace activation.
        const usedForActivation = await this.db.activationRequest.findFirst({
            where: { method: 'BKASH', transaction_id: transactionId },
            select: { id: true },
        });
        if (usedForActivation) throw this.duplicateTransaction();

        const [tenant, submitter, payment] = await Promise.all([
            this.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }),
            this.db.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } }),
            this.getPaymentInstructions(),
        ]);

        const amount = Number(pkg.price);
        const label = CHANNEL_LABEL[channel];
        const subject = `Credit top-up: ${pkg.name} — bKash ${transactionId}`.slice(0, 200);
        const body = [
            'Messaging credit top-up — please verify the bKash payment.',
            '',
            `Package: ${pkg.name} (${pkg.credits.toLocaleString('en-US')} ${label} credits)`,
            `Amount: ৳${amount.toFixed(2)}`,
            `Paid by bKash to: ${payment.bkash_number ?? '—'}`,
            `TrxID: ${transactionId}`,
            `Sent from: ${senderNumber}`,
            ...(note ? [`Note: ${note}`] : []),
            '',
            'Credits are added only after an admin approves this in Admin › Credit Top-ups.',
        ].join('\n');

        let created: { request: RequestRow; ticketNumber: number; threadId: string };
        try {
            created = await this.db.$transaction(async (tx) => {
                const thread = await tx.supportThread.create({
                    data: {
                        tenantId: ctx.tenantId,
                        subject,
                        category: 'support',
                        createdById: ctx.userId,
                        messages: {
                            create: { senderId: ctx.userId, senderRole: 'owner', body },
                        },
                    },
                    select: { id: true, ticketNumber: true },
                });

                const request = await tx.creditTopupRequest.create({
                    data: {
                        tenant_id: ctx.tenantId,
                        submitted_by: ctx.userId,
                        channel,
                        package_id: pkg.id,
                        package_name: pkg.name,
                        credits: pkg.credits,
                        amount: new Prisma.Decimal(amount),
                        currency: pkg.currency,
                        method: 'BKASH',
                        transaction_id: transactionId,
                        sender_number: senderNumber,
                        note,
                        support_thread_id: thread.id,
                    },
                    include: { supportThread: { select: { ticketNumber: true } } },
                });

                return { request, ticketNumber: thread.ticketNumber, threadId: thread.id };
            });
        } catch (err) {
            // P2002 on (method, transaction_id): the real guarantee that one
            // receipt buys one package, translated into something actionable.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw this.duplicateTransaction();
            }
            throw err;
        }

        this.audit
            .log('CREDIT_TOPUP_REQUESTED', 'CreditTopupRequest', { userId: ctx.userId, tenantId: ctx.tenantId }, created.request.id, {
                channel,
                package: pkg.name,
                credits: pkg.credits,
                amount,
                transaction_id: transactionId,
            })
            .catch(() => {});

        this.supportEvents.publish({
            kind: 'message',
            tenantId: ctx.tenantId,
            threadId: created.threadId,
            ticketNumber: created.ticketNumber,
            status: 'open',
            actor: 'owner',
        });

        void this.alertTeam({
            tenantName: tenant?.name ?? ctx.tenantId,
            packageName: pkg.name,
            amount,
            transactionId,
            senderNumber,
            ticketNumber: created.ticketNumber,
            submitter: submitter?.name || submitter?.email || null,
        });

        return this.mapRequest(created.request);
    }

    /**
     * Where to send the money. Every field but the number is optional, and the
     * number has a default, so the screen always has something to act on.
     */
    async getPaymentInstructions() {
        const group = await this.settings.getGroup('credit_topups').catch(() => ({} as Record<string, string | null>));
        const value = (key: string) => {
            const raw = group[key];
            return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
        };
        return {
            method: 'BKASH' as const,
            /** A personal wallet: the shop uses bKash "Send Money", not "Payment". */
            account_type: 'personal' as const,
            bkash_number: value('bkash_number'),
            instructions: value('instructions'),
        };
    }

    // ── Admin side ─────────────────────────────────────────────────────────────

    async listRequests(status?: CreditTopupStatus) {
        const rows = await this.db.creditTopupRequest.findMany({
            where: status ? { status } : undefined,
            orderBy: [{ created_at: 'desc' }],
            take: 200,
            include: {
                supportThread: { select: { ticketNumber: true } },
                tenant: { select: { id: true, name: true } },
            },
        });

        const userIds = [...new Set(rows.flatMap((row) => [row.submitted_by, row.reviewed_by]).filter(Boolean))] as string[];
        const users = userIds.length
            ? await this.db.user.findMany({
                  where: { id: { in: userIds } },
                  select: { id: true, name: true, email: true, mobile: true },
              })
            : [];
        const byId = new Map(users.map((user) => [user.id, user]));

        return rows.map((row) => {
            const submitter = byId.get(row.submitted_by);
            const reviewer = row.reviewed_by ? byId.get(row.reviewed_by) : undefined;
            return {
                ...this.mapRequest(row),
                tenant: { id: row.tenant.id, name: row.tenant.name },
                submitted_by: submitter
                    ? { name: submitter.name, email: submitter.email, mobile: submitter.mobile }
                    : null,
                reviewed_by: reviewer ? { name: reviewer.name, email: reviewer.email } : null,
            };
        });
    }

    /**
     * Confirm the money arrived and add the credits.
     *
     * The admin's figures win over the claim: `amount` is what reached the
     * bKash wallet and is what the ledger records; `credits` lets a short
     * payment buy fewer credits rather than forcing a reject. The status flip,
     * the grant, the payment record and the ticket reply all commit together.
     */
    async approve(requestId: string, adminUserId: string, dto: ApproveCreditTopupRequestDto) {
        const request = await this.findPendingOrThrow(requestId);
        if (!isMessagingChannel(request.channel)) {
            throw new BadRequestException(`Unknown credit channel ${request.channel}.`);
        }
        const channel = request.channel;
        const credits = dto.credits ?? request.credits;
        const amount = dto.amount ?? Number(request.amount);
        const note = dto.note?.trim() || null;
        const label = CHANNEL_LABEL[channel];

        const result = await this.db.$transaction(async (tx) => {
            const updated = await tx.creditTopupRequest.updateMany({
                where: { id: requestId, status: 'PENDING' },
                data: {
                    status: 'APPROVED',
                    reviewed_by: adminUserId,
                    reviewed_at: new Date(),
                    review_note: note,
                    credits_granted: credits,
                    amount_received: new Prisma.Decimal(amount),
                },
            });
            // Two admins approving the same request must not both grant. The
            // status filter makes the transition the lock.
            if (updated.count === 0) {
                throw new ConflictException('This request was just reviewed by someone else.');
            }

            const grant = await this.credits.grantCredits(
                request.tenant_id,
                channel,
                credits,
                {
                    type: 'PURCHASE',
                    reference: `bkash:${request.transaction_id}`,
                    description: `${request.package_name} — bKash ${request.transaction_id}`,
                },
                tx,
            );

            // A zero amount is a goodwill grant: credits, but no money to record.
            if (amount > 0) {
                await tx.billingEvent.create({
                    data: {
                        tenant_id: request.tenant_id,
                        provider_name: 'bkash',
                        external_event_id: `credit_topup_${request.id}`,
                        event_type: CHANNEL_SALE_EVENT_TYPE[channel],
                        status: 'succeeded',
                        reference_id: request.transaction_id,
                        amount: new Prisma.Decimal(amount),
                        currency: request.currency,
                        payload: {
                            credit_topup_request_id: request.id,
                            channel,
                            credits,
                            method: 'bkash',
                            transaction_id: request.transaction_id,
                            sender_number: request.sender_number,
                            recorded_by: adminUserId,
                            notes: note,
                        },
                    },
                });
            }

            if (request.support_thread_id) {
                await this.replyOnTicket(
                    tx,
                    request.support_thread_id,
                    adminUserId,
                    `Payment verified — ${credits.toLocaleString('en-US')} ${label} credits have been added. ` +
                        `Your ${label} balance is now ${grant.balance.toLocaleString('en-US')}.` +
                        (note ? `\n\n${note}` : ''),
                );
            }

            return grant;
        });

        this.audit
            .log('CREDIT_TOPUP_APPROVED', 'CreditTopupRequest', { userId: adminUserId, tenantId: request.tenant_id }, request.id, {
                channel,
                credits,
                amount,
                transaction_id: request.transaction_id,
                balance: result.balance,
            })
            .catch(() => {});

        this.publishTicketResolved(request);

        return {
            id: request.id,
            status: 'APPROVED' as const,
            channel,
            credits_granted: credits,
            amount_received: amount,
            balance: result.balance,
        };
    }

    async reject(requestId: string, adminUserId: string, dto: RejectCreditTopupRequestDto) {
        const request = await this.findPendingOrThrow(requestId);
        const reason = dto.reason.trim();

        await this.db.$transaction(async (tx) => {
            const updated = await tx.creditTopupRequest.updateMany({
                where: { id: requestId, status: 'PENDING' },
                data: {
                    status: 'REJECTED',
                    reviewed_by: adminUserId,
                    reviewed_at: new Date(),
                    review_note: reason,
                },
            });
            if (updated.count === 0) {
                throw new ConflictException('This request was just reviewed by someone else.');
            }

            if (request.support_thread_id) {
                await this.replyOnTicket(
                    tx,
                    request.support_thread_id,
                    adminUserId,
                    `We could not verify this payment, so no credits were added.\n\nReason: ${reason}`,
                );
            }
        });

        this.audit
            .log('CREDIT_TOPUP_REJECTED', 'CreditTopupRequest', { userId: adminUserId, tenantId: request.tenant_id }, request.id, {
                reason,
                transaction_id: request.transaction_id,
            })
            .catch(() => {});

        this.publishTicketResolved(request);

        return { id: request.id, status: 'REJECTED' as const };
    }

    // ── Packages (Admin › Credit Top-ups › Packages) ───────────────────────────

    async listPackages() {
        const packages = await this.db.smsPackage.findMany({
            orderBy: [{ channel: 'asc' }, { sort_order: 'asc' }, { price: 'asc' }],
        });
        return packages.map((pkg) => this.credits.mapPackage(pkg));
    }

    async createPackage(dto: CreateCreditPackageDto) {
        const pkg = await this.db.smsPackage.create({
            data: {
                channel: dto.channel,
                name: dto.name.trim(),
                credits: dto.credits,
                price: new Prisma.Decimal(dto.price),
                currency: 'BDT',
                is_active: dto.is_active ?? true,
                sort_order: dto.sort_order ?? 0,
            },
        });
        return this.credits.mapPackage(pkg);
    }

    /**
     * Edit a package. Its channel is fixed: a package moved to another channel
     * would rewrite what every past top-up request against it bought. Retire it
     * (`is_active: false`) and add a new one instead.
     */
    async updatePackage(id: string, dto: UpdateCreditPackageDto) {
        const existing = await this.db.smsPackage.findUnique({ where: { id }, select: { id: true } });
        if (!existing) throw new NotFoundException('Package not found');

        const pkg = await this.db.smsPackage.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.credits !== undefined ? { credits: dto.credits } : {}),
                ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
                ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
                ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
            },
        });
        return this.credits.mapPackage(pkg);
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    private async findPendingOrThrow(requestId: string) {
        const request = await this.db.creditTopupRequest.findUnique({ where: { id: requestId } });
        if (!request) throw new NotFoundException('Top-up request not found');
        if (request.status !== 'PENDING') {
            throw new ConflictException(`This request was already ${request.status.toLowerCase()}.`);
        }
        return request;
    }

    /** Post the decision to the request's ticket and close it. */
    private async replyOnTicket(
        tx: Prisma.TransactionClient,
        threadId: string,
        adminUserId: string,
        body: string,
    ) {
        await tx.supportMessage.create({
            data: { threadId, senderId: adminUserId, senderRole: 'admin', body },
        });
        await tx.supportThread.update({ where: { id: threadId }, data: { status: 'resolved' } });
    }

    private publishTicketResolved(request: { tenant_id: string; support_thread_id: string | null }) {
        if (!request.support_thread_id) return;
        const threadId = request.support_thread_id;
        this.db.supportThread
            .findUnique({ where: { id: threadId }, select: { ticketNumber: true } })
            .then((thread) => {
                if (!thread) return;
                this.supportEvents.publish({
                    kind: 'status',
                    tenantId: request.tenant_id,
                    threadId,
                    ticketNumber: thread.ticketNumber,
                    status: 'resolved',
                    actor: 'admin',
                });
            })
            .catch(() => {});
    }

    private async alertTeam(input: {
        tenantName: string;
        packageName: string;
        amount: number;
        transactionId: string;
        senderNumber: string;
        ticketNumber: number;
        submitter: string | null;
    }) {
        try {
            const frontendUrl = await this.email.getFrontendUrl().catch(() => '');
            await this.email.sendCreditTopupRequestAlert({
                tenantName: input.tenantName,
                packageName: input.packageName,
                amount: input.amount,
                transactionId: input.transactionId,
                senderNumber: input.senderNumber,
                ticketNumber: input.ticketNumber,
                reviewUrl: frontendUrl ? `${frontendUrl}/admin/credit-topups` : null,
            });
        } catch (err) {
            this.logger.warn(`Credit top-up alert failed: ${(err as Error)?.message}`);
        }
    }

    private duplicateTransaction() {
        return new ConflictException(
            'That transaction ID has already been submitted. Check the TrxID in your bKash SMS, or contact support if you think this is a mistake.',
        );
    }

    private mapRequest(row: RequestRow | (Omit<RequestRow, 'supportThread'> & { supportThread?: { ticketNumber: number } | null })) {
        return {
            id: row.id,
            channel: row.channel,
            package_id: row.package_id,
            package_name: row.package_name,
            credits: row.credits,
            amount: Number(row.amount),
            currency: row.currency,
            method: row.method,
            transaction_id: row.transaction_id,
            sender_number: row.sender_number,
            note: row.note,
            status: row.status,
            ticket_number: row.supportThread?.ticketNumber ?? null,
            review_note: row.review_note,
            reviewed_at: row.reviewed_at,
            credits_granted: row.credits_granted,
            amount_received: row.amount_received === null ? null : Number(row.amount_received),
            created_at: row.created_at,
        };
    }

    private async requireTenantMembership(ctx: TenantContext) {
        const membership = await this.db.tenantUser.findUnique({
            where: { tenant_id_user_id: { tenant_id: ctx.tenantId, user_id: ctx.userId } },
        });
        if (!membership) throw new ForbiddenException('Invalid tenant context');
        return membership;
    }

    private async canManageBilling(ctx: TenantContext): Promise<boolean> {
        return hasStorePermission(this.db, ctx, StorePermission.MANAGE_USERS);
    }

    private async assertBillingAccess(ctx: TenantContext): Promise<void> {
        if (!(await this.canManageBilling(ctx))) {
            throw new ForbiddenException('Only owners and managers can buy messaging credits.');
        }
    }
}

/** bKash prints TrxIDs in capitals; people retype them in any case. */
export function normalizeTransactionId(raw: string): string {
    return raw.replace(/\s+/g, '').toUpperCase();
}
