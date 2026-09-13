import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AccountingService } from '../accounting/accounting.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PasswordResetService } from '../password-reset/password-reset.service';
import { AuditService } from '../audit/audit.service';
import {
    AttachTenantDto,
    CreatePayoutRequestDto,
    CreateRefereeDto,
    ListAttachableTenantsQueryDto,
    ListCommissionsQueryDto,
    ListPayoutRequestsQueryDto,
    ListRefereesQueryDto,
    RecordPaymentDto,
    TrackClickDto,
    UpdatePayoutProfileDto,
    UpdateRefereeDto,
} from './referrals.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { buildActivity, activityWindowStart } from './referral-activity';

/** Matches the cap in ListCommissionsQueryDto; kept here so the service has a default of its own. */
const DEFAULT_COMMISSION_PAGE_SIZE = 50;

/**
 * How many businesses the attach picker returns. It is a search box, not a
 * browsable list — a platform with thousands of tenants must not ship all of
 * them to a modal, and an admin attributing a specific business knows its name.
 */
const ATTACHABLE_TENANT_PAGE_SIZE = 20;

@Injectable()
export class ReferralsService {
    private readonly logger = new Logger(ReferralsService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly passwordReset: PasswordResetService,
        private readonly email: EmailService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly accounting: AccountingService,
        private readonly audit: AuditService,
    ) {}

    // ── Referees ──────────────────────────────────────────────────────────────

    async createReferee(dto: CreateRefereeDto, adminUserId: string) {
        const existing = await this.db.referee.findFirst({
            where: { email: dto.email, deleted_at: null },
        });
        if (existing) throw new ConflictException('A referee with this email already exists');

        const referral_code = this.generateReferralCode(dto.name);

        const referee = await this.db.referee.create({
            data: {
                name: dto.name,
                email: dto.email,
                phone: dto.phone,
                referral_code,
                commission_rate: dto.commission_rate,
                signup_discount: dto.signup_discount,
                notes: dto.notes,
                created_by: adminUserId,
            },
        });

        await this.ensureRefereeUserAccount(referee.id);
        return this.mapReferee(referee);
    }

    async sendRefereeLoginInvite(refereeId: string) {
        const referee = await this.db.referee.findUnique({ where: { id: refereeId } });
        if (!referee) throw new NotFoundException('Referee not found');
        if (referee.deleted_at) throw new BadRequestException('Cannot send invite to an archived referee');

        await this.ensureRefereeUserAccount(referee.id);
        return { sent: true, email: referee.email };
    }

    private async ensureRefereeUserAccount(refereeId: string) {
        const referee = await this.db.referee.findUnique({ where: { id: refereeId } });
        if (!referee) throw new NotFoundException('Referee not found');

        let user = referee.user_id
            ? await this.db.user.findUnique({ where: { id: referee.user_id } })
            : await this.db.user.findUnique({ where: { email: referee.email } });

        if (!user) {
            const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
            user = await this.db.user.create({
                data: {
                    email: referee.email,
                    passwordHash,
                    name: referee.name,
                },
            });
        }

        if (referee.user_id !== user.id) {
            const linkedElsewhere = await this.db.referee.findFirst({
                where: { user_id: user.id, id: { not: referee.id } },
            });
            if (linkedElsewhere) {
                throw new ConflictException('This user account is already linked to another referee');
            }

            await this.db.referee.update({
                where: { id: referee.id },
                data: { user_id: user.id },
            });
        }

        await this.passwordReset.requestRefereeInvite({
            email: user.email,
            name: referee.name,
            referralCode: referee.referral_code,
            phone: referee.phone,
        });
    }

    /** Resolve the active referee profile for a signed-in user, linking by email when needed. */
    async resolveActiveRefereeForUser(userId: string, email: string) {
        const select = {
            id: true,
            name: true,
            email: true,
            referral_code: true,
            signup_discount: true,
            commission_rate: true,
            is_active: true,
            user_id: true,
        } as const;

        const byUserId = await this.db.referee.findFirst({
            where: { user_id: userId, is_active: true, deleted_at: null },
            select,
        });
        if (byUserId) return byUserId;

        const byEmail = await this.db.referee.findFirst({
            where: { email, is_active: true, deleted_at: null },
            select,
        });
        if (!byEmail) return null;
        if (byEmail.user_id && byEmail.user_id !== userId) return null;

        if (!byEmail.user_id) {
            const linkedElsewhere = await this.db.referee.findFirst({
                where: { user_id: userId, id: { not: byEmail.id } },
            });
            if (linkedElsewhere) return null;

            await this.db.referee.update({
                where: { id: byEmail.id },
                data: { user_id: userId },
            });
            return { ...byEmail, user_id: userId };
        }

        return byEmail;
    }

    private mapReferee(r: any) {
        return {
            ...r,
            commission_rate: Number(r.commission_rate),
            signup_discount: Number(r.signup_discount),
        };
    }

    /**
     * List referees with their commission totals.
     *
     * The totals come from a single `groupBy` rather than three aggregates per
     * referee. The previous shape issued 1 + 3n queries — 1,501 at 500 partners —
     * for a page that renders one row each.
     *
     * Archived referees are excluded by default. They were previously returned
     * alongside active ones with no filter and no visual distinction, so a
     * soft-deleted partner looked like a live one.
     */
    async listReferees(query: ListRefereesQueryDto = {}) {
        const referees = await this.db.referee.findMany({
            where: query.include_archived ? {} : { deleted_at: null },
            orderBy: { created_at: 'desc' },
            include: {
                _count: { select: { referralSignups: true } },
            },
        });

        if (referees.length === 0) return [];

        const refereeIds = referees.map((r) => r.id);
        const [grouped, clicksByReferee] = await Promise.all([
            this.db.referralSignup.groupBy({
                by: ['referee_id', 'status'],
                where: { referee_id: { in: refereeIds } },
                _count: { _all: true },
                _sum: { commission_amount: true },
            }),
            // Second grouped query rather than a per-referee count, for the same
            // reason the stats above are grouped: this page renders one row each.
            this.db.referralClick.groupBy({
                by: ['referee_id'],
                where: { referee_id: { in: refereeIds } },
                _count: { _all: true },
            }),
        ]);
        const clickCounts = new Map(clicksByReferee.map((c) => [c.referee_id, c._count._all]));

        const key = (refereeId: string, status: string) => `${refereeId}:${status}`;
        const totals = new Map(
            grouped.map((g) => [
                key(g.referee_id, g.status),
                {
                    count: g._count._all,
                    amount: Number(g._sum.commission_amount ?? 0),
                },
            ]),
        );
        const totalsFor = (refereeId: string, status: string) =>
            totals.get(key(refereeId, status)) ?? { count: 0, amount: 0 };

        return referees.map((r) => {
            const earned = totalsFor(r.id, 'EARNED');
            const paid = totalsFor(r.id, 'PAID');
            const reversed = totalsFor(r.id, 'REVERSED');
            const clicks = clickCounts.get(r.id) ?? 0;
            return {
                ...this.mapReferee(r),
                stats: {
                    ...this.conversionStats(clicks, r._count.referralSignups),
                    pending_signups: totalsFor(r.id, 'PENDING').count,
                    earned_count: earned.count,
                    earned_amount: this.round2(earned.amount),
                    paid_count: paid.count,
                    paid_amount: this.round2(paid.amount),
                    reversed_count: reversed.count,
                    reversed_amount: this.round2(reversed.amount),
                },
            };
        });
    }

    async getReferee(id: string) {
        const referee = await this.db.referee.findUnique({
            where: { id },
            include: {
                referralSignups: {
                    orderBy: { signed_up_at: 'desc' },
                    include: { tenant: { select: { id: true, name: true } } },
                },
                payments: { orderBy: { paid_at: 'desc' } },
            },
        });
        if (!referee) throw new NotFoundException('Referee not found');

        return {
            ...this.mapReferee(referee),
            referralSignups: referee.referralSignups.map(this.mapSignup),
            payments: referee.payments.map(this.mapPayment),
        };
    }

    async updateReferee(id: string, dto: UpdateRefereeDto) {
        const referee = await this.db.referee.findUnique({ where: { id } });
        if (!referee) throw new NotFoundException('Referee not found');
        if (referee.deleted_at) throw new BadRequestException('Archived referees cannot be edited');

        if (dto.email && dto.email !== referee.email) {
            const conflict = await this.db.referee.findFirst({
                where: { email: dto.email, deleted_at: null, id: { not: id } },
            });
            if (conflict) throw new ConflictException('Email already in use by another referee');
        }

        if (dto.referral_code) {
            const normalized = this.normalizeReferralCode(dto.referral_code);
            if (normalized !== referee.referral_code) {
                const conflict = await this.db.referee.findFirst({
                    where: { referral_code: normalized, id: { not: id } },
                });
                if (conflict) throw new ConflictException('Referral code already in use');
            }
        }

        const updated = await this.db.referee.update({
            where: { id },
            data: {
                ...(dto.name !== undefined && { name: dto.name }),
                ...(dto.email !== undefined && { email: dto.email }),
                ...(dto.phone !== undefined && { phone: dto.phone }),
                ...(dto.commission_rate !== undefined && { commission_rate: dto.commission_rate }),
                ...(dto.signup_discount !== undefined && { signup_discount: dto.signup_discount }),
                ...(dto.is_active !== undefined && { is_active: dto.is_active }),
                ...(dto.notes !== undefined && { notes: dto.notes }),
                ...(dto.referral_code !== undefined && { referral_code: this.normalizeReferralCode(dto.referral_code) }),
            },
        });

        return this.mapReferee(updated);
    }

    async deleteReferee(id: string) {
        const referee = await this.db.referee.findUnique({
            where: { id },
            include: {
                _count: { select: { referralSignups: true, payments: true } },
            },
        });
        if (!referee) throw new NotFoundException('Referee not found');
        if (referee.deleted_at) throw new BadRequestException('Referee is already archived');

        const hasLedger = referee._count.referralSignups > 0 || referee._count.payments > 0;

        if (hasLedger) {
            await this.db.referee.update({
                where: { id },
                data: {
                    deleted_at: new Date(),
                    is_active: false,
                    user_id: null,
                },
            });
            return { id, deleted: true, archived: true };
        }

        await this.db.referee.delete({ where: { id } });
        return { id, deleted: true, archived: false };
    }

    // ── Click tracking ────────────────────────────────────────────────────────

    /**
     * Record a visit to a partner's tracking link.
     *
     * Returns nothing and throws nothing for an unknown or inactive code: the
     * caller is an anonymous visitor being redirected to signup, and neither a
     * 404 nor a delay should be observable from outside — otherwise this endpoint
     * becomes a way to enumerate which referral codes exist.
     */
    async recordClick(code: string, meta: TrackClickDto = {}): Promise<void> {
        const normalized = this.normalizeReferralCode(code);
        const referee = await this.db.referee.findFirst({
            where: { referral_code: normalized, is_active: true, deleted_at: null },
            select: { id: true },
        });
        if (!referee) return;

        await this.db.referralClick.create({
            data: {
                referee_id: referee.id,
                code: normalized,
                referrer: this.truncate(meta.referrer),
                user_agent: this.truncate(meta.user_agent),
            },
        });
    }

    /** Both columns take arbitrary caller-supplied text; keep them bounded. */
    private truncate(value?: string | null): string | null {
        if (!value) return null;
        const trimmed = value.trim();
        return trimmed ? trimmed.slice(0, 500) : null;
    }

    /**
     * Clicks and conversion rate for one partner.
     *
     * `conversion_rate` is null rather than 0 when there are no clicks — "0%" reads
     * as "nobody converted" when the truth is "nobody has visited yet", and a
     * partner looking at their own dashboard should not be told they are failing
     * before they have started.
     */
    private conversionStats(clicks: number, signups: number) {
        return {
            clicks,
            conversion_rate: clicks > 0 ? Math.round((signups / clicks) * 1000) / 10 : null,
        };
    }

    // ── Commissions ───────────────────────────────────────────────────────────

    /**
     * Commissions across every referee. This is the one referral query with no
     * natural bound — it grows with total signups, not with one partner's history —
     * so it pages rather than returning the whole table. The response is wrapped
     * because a bare array cannot say how much was left behind.
     */
    async listCommissions(query: ListCommissionsQueryDto) {
        const where = {
            ...(query.referee_id && { referee_id: query.referee_id }),
            ...(query.status && { status: query.status }),
        };
        const limit = query.limit ?? DEFAULT_COMMISSION_PAGE_SIZE;
        const offset = query.offset ?? 0;

        const [commissions, total] = await Promise.all([
            this.db.referralSignup.findMany({
                where,
                orderBy: { signed_up_at: 'desc' },
                skip: offset,
                take: limit,
                include: {
                    referee: { select: { id: true, name: true, email: true, referral_code: true } },
                    tenant: { select: { id: true, name: true } },
                },
            }),
            this.db.referralSignup.count({ where }),
        ]);

        return {
            items: commissions.map(this.mapSignup),
            total,
            limit,
            offset,
            has_more: offset + commissions.length < total,
        };
    }

    // ── Payments ──────────────────────────────────────────────────────────────

    /**
     * Record a payout to a referee and mark the commissions it settles as PAID.
     *
     * The amount and the commissions it clears are reconciled rather than tracked
     * independently. Previously `amount` was free-form and the selected ids were
     * flipped to PAID regardless of it, so a ৳1 payment could clear ৳50,000 of
     * earned commission and the resulting drift was then absorbed by the
     * `balance_due` clamp in `getLedger` instead of surfacing anywhere.
     *
     * `amount` is now optional and defaults to exactly what the selected
     * commissions are worth. A deliberate part-payment is still possible, but it
     * has to say so via `allow_partial` — silence no longer means "trust me".
     */
    async recordPayment(refereeId: string, dto: RecordPaymentDto, adminUserId: string) {
        const referee = await this.db.referee.findUnique({ where: { id: refereeId } });
        if (!referee) throw new NotFoundException('Referee not found');
        if (referee.deleted_at) throw new BadRequestException('Cannot record payment for an archived referee');

        const earned = await this.db.referralSignup.findMany({
            where: { referee_id: refereeId, status: 'EARNED' },
        });
        if (earned.length === 0) throw new BadRequestException('No earned commissions to pay');

        const earnedIds = new Set(earned.map((s) => s.id));
        const ids = dto.commission_ids?.length
            ? dto.commission_ids
            : earned.map((s) => s.id);

        // An id that is not payable — already paid, belonging to another referee, or
        // simply mistyped — used to be dropped on the floor and the payout recorded
        // as if it had been included. Name it instead.
        const unknown = ids.filter((id) => !earnedIds.has(id));
        if (unknown.length > 0) {
            throw new BadRequestException(
                `These commissions are not awaiting payment for this referee: ${unknown.join(', ')}`,
            );
        }

        const toMark = earned.filter((s) => ids.includes(s.id));
        if (toMark.length === 0) throw new BadRequestException('No matching earned commissions found');

        const owed = this.round2(
            toMark.reduce((sum, s) => sum + Number(s.commission_amount ?? 0), 0),
        );
        const amount = dto.amount === undefined ? owed : this.round2(dto.amount);

        if (amount !== owed && !dto.allow_partial) {
            throw new BadRequestException(
                `Payment of ${amount} does not match the ${owed} owed on the selected ` +
                `commission(s). Adjust the amount, change the selection, or set ` +
                `allow_partial to record a deliberate part-payment.`,
            );
        }

        // A payout raised by the partner is settled by the same call that records the
        // money, inside the same transaction — so a request can never read as PAID
        // without a payment row behind it, or vice versa.
        if (dto.payout_request_id) {
            const request = await this.db.refereePayoutRequest.findFirst({
                where: { id: dto.payout_request_id, referee_id: refereeId },
                select: { status: true },
            });
            if (!request) {
                throw new BadRequestException('That payout request does not belong to this referee');
            }
            if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
                throw new BadRequestException(
                    `That payout request is already ${request.status.toLowerCase()} and cannot be settled again`,
                );
            }
        }

        const payment = await this.db.$transaction(async (tx) => {
            const newPayment = await tx.refereePayment.create({
                data: {
                    referee_id: refereeId,
                    amount,
                    method: dto.method,
                    reference: dto.reference,
                    notes: dto.notes,
                    created_by: adminUserId,
                },
            });

            await tx.referralSignup.updateMany({
                where: { id: { in: toMark.map((s) => s.id) } },
                data: {
                    status: 'PAID',
                    paid_at: new Date(),
                    referee_payment_id: newPayment.id,
                },
            });

            if (dto.payout_request_id) {
                await tx.refereePayoutRequest.update({
                    where: { id: dto.payout_request_id },
                    data: {
                        status: 'PAID',
                        payment_id: newPayment.id,
                        reviewed_at: new Date(),
                        reviewed_by: adminUserId,
                    },
                });
            }

            return newPayment;
        });

        // Same reasoning as the notification below: the payout is already recorded,
        // so a failed posting is a warning rather than a rollback. Reversing a real
        // money movement because the bookkeeping leg failed would be worse than a
        // missing journal entry that an admin can add by hand.
        await this.postCommissionExpense(payment.id, referee.name, amount, dto.reference)
            .catch((err) => {
                this.logger.warn(
                    `Payment ${payment.id} recorded but posting it to the platform books failed: ${err}`,
                );
            });

        // Same reasoning as the earned notification in BillingService: the payout is
        // already recorded, so a failed email is a warning, not a failure.
        this.email.sendRefereePaymentRecorded(
            referee.email,
            referee.name,
            amount,
            dto.method,
            dto.reference,
        ).catch((err) => {
            this.logger.warn(
                `Payment recorded for referee ${refereeId} but the notification email failed: ${err}`,
            );
        });

        return this.mapPayment(payment);
    }

    async listPayments(refereeId: string) {
        const referee = await this.db.referee.findUnique({ where: { id: refereeId } });
        if (!referee) throw new NotFoundException('Referee not found');

        const payments = await this.db.refereePayment.findMany({
            where: { referee_id: refereeId },
            orderBy: { paid_at: 'desc' },
            include: {
                commissions: {
                    include: { tenant: { select: { id: true, name: true } } },
                },
            },
        });

        return payments.map((p) => ({
            ...this.mapPayment(p),
            commissions: (p.commissions ?? []).map(this.mapSignup),
        }));
    }

    async getLedger(refereeId: string) {
        const referee = await this.db.referee.findUnique({
            where: { id: refereeId },
            select: {
                id: true,
                name: true,
                email: true,
                referral_code: true,
                // The portal's printable one-pager states the discount the referred
                // business gets, so it has to come from the same row the code does.
                signup_discount: true,
                // Prefills the admin attach form, and is the partner's own rate, so
                // the portal showing it back to them is not a disclosure.
                commission_rate: true,
                deleted_at: true,
            },
        });
        if (!referee) throw new NotFoundException('Referee not found');

        const now = new Date();
        const [commissions, payments, clicks, windowedClicks] = await Promise.all([
            this.db.referralSignup.findMany({
                where: { referee_id: refereeId },
                orderBy: { signed_up_at: 'desc' },
                include: { tenant: { select: { id: true, name: true } } },
            }),
            this.db.refereePayment.findMany({
                where: { referee_id: refereeId },
                orderBy: { paid_at: 'desc' },
                // The portal's payment page shows what each payout settled; this is the
                // same join listPayments already performs.
                include: {
                    commissions: { include: { tenant: { select: { id: true, name: true } } } },
                },
            }),
            this.db.referralClick.count({ where: { referee_id: refereeId } }),
            // summary.clicks above is all-time. The chart buckets only span twelve
            // months, so they get their own bounded query rather than reusing it.
            this.db.referralClick.findMany({
                where: { referee_id: refereeId, occurred_at: { gte: activityWindowStart(now) } },
                select: { occurred_at: true },
            }),
        ]);

        // REVERSED is deliberately absent here: a clawed-back commission is not
        // earned. When it was already paid out, the payment below still counts, so
        // the difference lands in overpaid_amount and nets against the next payout —
        // which is the only place that money can honestly go once it has left.
        const totalEarned = this.round2(
            commissions
                .filter((c) => c.status === 'EARNED' || c.status === 'PAID')
                .reduce((sum, c) => sum + Number(c.commission_amount ?? 0), 0),
        );
        const totalReversed = this.round2(
            commissions
                .filter((c) => c.status === 'REVERSED')
                .reduce((sum, c) => sum + Number(c.commission_amount ?? 0), 0),
        );
        const totalPaid = this.round2(payments.reduce((sum, p) => sum + Number(p.amount), 0));

        return {
            referee: {
                ...referee,
                signup_discount: Number(referee.signup_discount),
                commission_rate: Number(referee.commission_rate),
            },
            summary: {
                ...this.conversionStats(clicks, commissions.length),
                total_referrals: commissions.length,
                pending: commissions.filter((c) => c.status === 'PENDING').length,
                earned: commissions.filter((c) => c.status === 'EARNED').length,
                paid: commissions.filter((c) => c.status === 'PAID').length,
                reversed: commissions.filter((c) => c.status === 'REVERSED').length,
                total_earned_amount: totalEarned,
                total_reversed_amount: totalReversed,
                total_paid_amount: totalPaid,
                balance_due: Math.max(0, this.round2(totalEarned - totalPaid)),
                // The mirror image of balance_due. Historically the clamp above was the
                // only thing standing between an unreconciled payout and the ledger, so
                // an overpayment simply read as "৳0 due" and nothing pointed at it.
                // recordPayment now refuses to create this state, but rows written
                // before that still exist, so the ledger says so out loud.
                overpaid_amount: Math.max(0, this.round2(totalPaid - totalEarned)),
            },
            activity: buildActivity(
                { clicks: windowedClicks, signups: commissions, payments },
                now,
            ),
            commissions: commissions.map(this.mapSignup),
            payments: payments.map((p) => ({
                ...this.mapPayment(p),
                commissions: (p.commissions ?? []).map(this.mapSignup),
            })),
        };
    }


    // ── Manual attribution ────────────────────────────────────────────────────

    /**
     * Businesses an admin can credit to a partner, newest first.
     *
     * Tenants that are already credited come back too, carrying the partner who
     * holds them. Filtering them out would make a business somebody else is
     * already earning on look exactly like a business that does not exist, and
     * "already credited to X" is usually the answer the admin came for.
     */
    async listAttachableTenants(query: ListAttachableTenantsQueryDto = {}) {
        const search = query.search?.trim();

        const tenants = await this.db.tenant.findMany({
            where: {
                deleted_at: null,
                // The platform's own workspace is not a customer, so nobody can be
                // paid for referring it — the same exclusion the admin tenant list makes.
                platform_workspace_key: null,
                ...(search
                    ? {
                        OR: [
                            { name: { contains: search, mode: 'insensitive' as const } },
                            { owner: { email: { contains: search, mode: 'insensitive' as const } } },
                            { owner: { name: { contains: search, mode: 'insensitive' as const } } },
                        ],
                    }
                    : {}),
            },
            orderBy: { created_at: 'desc' },
            take: ATTACHABLE_TENANT_PAGE_SIZE,
            select: {
                id: true,
                name: true,
                created_at: true,
                owner: { select: { name: true, email: true } },
                subscription: {
                    select: {
                        status: true,
                        billing_cycle: true,
                        plan: { select: { code: true, name: true } },
                    },
                },
                referralSignup: {
                    select: {
                        id: true,
                        status: true,
                        referee: { select: { id: true, name: true, referral_code: true } },
                    },
                },
            },
        });

        return tenants.map((tenant) => ({
            id: tenant.id,
            name: tenant.name,
            created_at: tenant.created_at,
            owner_name: tenant.owner?.name ?? null,
            owner_email: tenant.owner?.email ?? null,
            plan_code: tenant.subscription?.plan?.code ?? null,
            plan_name: tenant.subscription?.plan?.name ?? null,
            subscription_status: tenant.subscription?.status ?? null,
            billing_cycle: tenant.subscription?.billing_cycle ?? null,
            // Null is the only state an attach is allowed from; anything else is
            // rendered as "already credited" rather than offered as a choice.
            attached_to: tenant.referralSignup
                ? {
                    signup_id: tenant.referralSignup.id,
                    status: tenant.referralSignup.status,
                    referee_id: tenant.referralSignup.referee.id,
                    referee_name: tenant.referralSignup.referee.name,
                    referral_code: tenant.referralSignup.referee.referral_code,
                }
                : null,
        }));
    }

    /**
     * Credit an existing business to a partner after the fact.
     *
     * The referral code is typed at signup and nowhere else, so a business a
     * partner genuinely brought in but that left the box empty — or typed it
     * wrong, or signed up over the phone — is invisible to the ledger forever.
     * This is the way back.
     *
     * It writes exactly the row the signup path writes, PENDING and nothing else:
     * no money is credited here, and `billing.earnReferralCommission` still turns
     * it into a commission on the tenant's next activation, on the same terms as
     * every other referral. That is the whole reason this is an attachment rather
     * than an "add a commission" form — an admin cannot mint a balance with it.
     */
    async attachTenant(refereeId: string, dto: AttachTenantDto, adminUserId: string) {
        const referee = await this.db.referee.findUnique({ where: { id: refereeId } });
        if (!referee) throw new NotFoundException('Referee not found');
        if (referee.deleted_at) {
            throw new BadRequestException('Cannot attach a business to an archived referee');
        }

        const tenant = await this.db.tenant.findFirst({
            where: { id: dto.tenant_id, deleted_at: null, platform_workspace_key: null },
            select: {
                id: true,
                name: true,
                created_at: true,
                referralSignup: {
                    select: { id: true, referee: { select: { id: true, name: true } } },
                },
                users: { select: { user: { select: { id: true, email: true } } } },
            },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        if (tenant.referralSignup) {
            const holder = tenant.referralSignup.referee;
            throw new ConflictException(
                holder.id === refereeId
                    ? `${tenant.name} is already attached to this referee`
                    : `${tenant.name} is already attached to ${holder.name}. Detach that first.`,
            );
        }

        // The same rule the signup path enforces, for the same reason: a partner
        // must not earn commission on their own subscription. Checked by account
        // link and by email, because a referee who has never logged in has no
        // user_id to match on.
        const refereeEmail = referee.email.toLowerCase();
        const isSelfReferral = tenant.users.some((member) =>
            (referee.user_id !== null && member.user.id === referee.user_id) ||
            member.user.email.toLowerCase() === refereeEmail,
        );
        if (isSelfReferral) {
            throw new BadRequestException(
                'This referee is a member of that workspace — a partner cannot be credited for their own subscription',
            );
        }

        let signup;
        try {
            signup = await this.db.referralSignup.create({
                data: {
                    referee_id: refereeId,
                    tenant_id: tenant.id,
                    discount_pct: dto.discount_pct ?? referee.signup_discount,
                    commission_pct: dto.commission_pct ?? referee.commission_rate,
                    status: 'PENDING',
                    // The business signed up when it signed up. Stamping "now" would
                    // put a signup into this month's activity chart that happened last
                    // year, and date a commission from the paperwork rather than the sale.
                    signed_up_at: tenant.created_at,
                },
                include: { tenant: { select: { id: true, name: true } } },
            });
        } catch (err: any) {
            // tenant_id is unique, so a second admin attaching the same business
            // between the check above and this write loses the race rather than
            // producing a 500.
            if (err?.code === 'P2002') {
                throw new ConflictException(`${tenant.name} was attached to a referee moments ago`);
            }
            throw err;
        }

        this.audit.log(
            'REFERRAL_SIGNUP_ATTACHED',
            'ReferralSignup',
            { userId: adminUserId, tenantId: tenant.id },
            signup.id,
            {
                referee_id: refereeId,
                referral_code: referee.referral_code,
                discount_pct: Number(signup.discount_pct),
                commission_pct: Number(signup.commission_pct),
            },
        ).catch(() => {});

        this.logger.log(
            `Admin ${adminUserId} attached tenant ${tenant.id} to referee ${refereeId}`,
        );

        return this.mapSignup(signup);
    }

    /**
     * Undo an attribution — a mis-typed code at signup as much as a mis-aimed
     * attach.
     *
     * PENDING only. Once a commission is EARNED, PAID or REVERSED it is ledger
     * history: deleting the row would move a partner's balance with nothing left
     * to say why, and the honest correction for money already recorded is a
     * reversal, which is the refund path's job and not an admin's.
     */
    async detachTenant(signupId: string, adminUserId: string) {
        const signup = await this.db.referralSignup.findUnique({
            where: { id: signupId },
            select: {
                id: true,
                status: true,
                referee_id: true,
                tenant_id: true,
                tenant: { select: { name: true } },
            },
        });
        if (!signup) throw new NotFoundException('Referral attachment not found');

        if (signup.status !== 'PENDING') {
            throw new ConflictException(
                `This referral has already been ${signup.status.toLowerCase()} — a commission that has left PENDING cannot be detached`,
            );
        }

        await this.db.referralSignup.delete({ where: { id: signupId } });

        this.audit.log(
            'REFERRAL_SIGNUP_DETACHED',
            'ReferralSignup',
            { userId: adminUserId, tenantId: signup.tenant_id },
            signup.id,
            { referee_id: signup.referee_id },
        ).catch(() => {});

        this.logger.log(
            `Admin ${adminUserId} detached tenant ${signup.tenant_id} from referee ${signup.referee_id}`,
        );

        return { id: signupId, detached: true };
    }


    // ── Payouts ───────────────────────────────────────────────────────────────

    /**
     * Smallest balance a partner may raise a request for.
     *
     * A platform setting rather than a constant because the right floor depends on
     * what a payout costs to make, and that is an operator decision — bKash fees and
     * an admin's time make a ৳40 request cost more than it moves.
     */
    private async minPayoutAmount(): Promise<number> {
        const raw = await this.platformSettings.getRawValue('referral_program', 'min_payout_amount');
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
    }

    /**
     * Bangladeshi mobile wallets are all 11-digit numbers on a known operator
     * prefix. Checking that here is not bureaucracy: `recordPayment` sends real
     * money to whatever this says, and a transposed digit reaches a real stranger's
     * wallet rather than bouncing.
     *
     * Bank accounts have no shared format across Bangladeshi banks, so those are
     * length-checked and the bank name is required instead — an admin reading the
     * payout row can resolve an ambiguous account number, but not an absent bank.
     */
    private assertPayoutDestination(dto: UpdatePayoutProfileDto) {
        const digits = (dto.payout_account_number ?? '').replace(/[\s-]/g, '');

        if (dto.payout_method === 'BANK') {
            if (!dto.payout_bank_name?.trim()) {
                throw new BadRequestException('Bank name is required for a bank payout');
            }
            if (!/^[A-Za-z0-9]{6,25}$/.test(digits)) {
                throw new BadRequestException('Enter a valid bank account number (6–25 letters or digits)');
            }
            return digits;
        }

        // 01XXXXXXXXX, optionally written +880… or 880… as people actually type it.
        const local = digits.replace(/^(?:\+?880)/, '0');
        if (!/^01[3-9]\d{8}$/.test(local)) {
            throw new BadRequestException(
                'Enter a valid Bangladeshi mobile number for the wallet, e.g. 01712345678',
            );
        }
        return local;
    }

    async getPayoutProfile(refereeId: string) {
        const referee = await this.db.referee.findUnique({
            where: { id: refereeId },
            select: {
                payout_method: true,
                payout_account_name: true,
                payout_account_number: true,
                payout_bank_name: true,
                payout_branch: true,
                payout_updated_at: true,
            },
        });
        if (!referee) throw new NotFoundException('Referee not found');

        return {
            ...referee,
            is_complete: !!referee.payout_method && !!referee.payout_account_number,
            min_payout_amount: await this.minPayoutAmount(),
        };
    }

    /**
     * A partner editing where their money goes.
     *
     * Deliberately does not touch requests already in flight: each request carries
     * its own snapshot of the destination, so a partner who changes their wallet
     * number cannot redirect a payout an admin has already approved against the old
     * one. New requests pick up the new details.
     */
    async updatePayoutProfile(refereeId: string, dto: UpdatePayoutProfileDto) {
        const referee = await this.db.referee.findUnique({ where: { id: refereeId } });
        if (!referee) throw new NotFoundException('Referee not found');
        if (referee.deleted_at) throw new BadRequestException('This partner account is archived');

        const accountNumber = this.assertPayoutDestination(dto);

        await this.db.referee.update({
            where: { id: refereeId },
            data: {
                payout_method: dto.payout_method,
                payout_account_name: dto.payout_account_name?.trim() || null,
                payout_account_number: accountNumber,
                payout_bank_name: dto.payout_method === 'BANK' ? dto.payout_bank_name!.trim() : null,
                payout_branch: dto.payout_method === 'BANK' ? dto.payout_branch?.trim() || null : null,
                payout_updated_at: new Date(),
            },
        });

        return this.getPayoutProfile(refereeId);
    }

    /**
     * What the partner is owed right now.
     *
     * Same arithmetic as `getLedger`'s summary and for the same reasons — REVERSED
     * is not earned, and an overpayment nets against what is owed rather than being
     * clamped away. Split out because a payout request must not load twelve months
     * of activity to answer one question.
     */
    private async balanceDue(refereeId: string): Promise<number> {
        const [earnedAgg, paidAgg] = await Promise.all([
            this.db.referralSignup.aggregate({
                where: { referee_id: refereeId, status: { in: ['EARNED', 'PAID'] } },
                _sum: { commission_amount: true },
            }),
            this.db.refereePayment.aggregate({
                where: { referee_id: refereeId },
                _sum: { amount: true },
            }),
        ]);

        const earned = this.round2(Number(earnedAgg._sum.commission_amount ?? 0));
        const paid = this.round2(Number(paidAgg._sum.amount ?? 0));
        return Math.max(0, this.round2(earned - paid));
    }

    async listPayoutRequests(refereeId: string) {
        const requests = await this.db.refereePayoutRequest.findMany({
            where: { referee_id: refereeId },
            orderBy: { requested_at: 'desc' },
        });
        return requests.map(this.mapPayoutRequest);
    }

    /**
     * A partner asking for what the ledger already says they are owed.
     *
     * Nothing about the ledger changes here. No commission is reserved, no balance
     * is held: the request records an intent, and money moves only when an admin
     * records a real `RefereePayment` — the same path payouts have always taken.
     * The consequence worth stating is that two requests raised against one balance
     * would both look payable, which is why only one may be open at a time.
     */
    async requestPayout(refereeId: string, dto: CreatePayoutRequestDto) {
        const referee = await this.db.referee.findUnique({ where: { id: refereeId } });
        if (!referee) throw new NotFoundException('Referee not found');
        if (referee.deleted_at) throw new BadRequestException('This partner account is archived');
        if (!referee.is_active) throw new BadRequestException('This partner account is not active');

        if (!referee.payout_method || !referee.payout_account_number) {
            throw new BadRequestException(
                'Add your payout details before requesting a payout',
            );
        }

        const open = await this.db.refereePayoutRequest.findFirst({
            where: { referee_id: refereeId, status: { in: ['PENDING', 'APPROVED'] } },
        });
        if (open) {
            throw new BadRequestException(
                'You already have a payout request in progress. It has to be settled or declined before you can raise another.',
            );
        }

        const [balance, minimum] = await Promise.all([
            this.balanceDue(refereeId),
            this.minPayoutAmount(),
        ]);

        if (balance < minimum) {
            throw new BadRequestException(
                `The minimum payout is ${minimum}. Your current balance is ${balance}.`,
            );
        }

        const amount = dto.amount === undefined ? balance : this.round2(dto.amount);
        if (amount > balance) {
            throw new BadRequestException(
                `You can request at most ${balance}, which is your current balance.`,
            );
        }
        if (amount < minimum) {
            throw new BadRequestException(`The minimum payout is ${minimum}.`);
        }

        const request = await this.db.refereePayoutRequest.create({
            data: {
                referee_id: refereeId,
                amount,
                method: referee.payout_method,
                account_name: referee.payout_account_name,
                account_number: referee.payout_account_number,
                bank_name: referee.payout_bank_name,
                branch: referee.payout_branch,
                note: dto.note?.trim() || null,
            },
        });

        // Same reasoning as every other notification here: the request is recorded,
        // so a failed email is a warning rather than a rollback.
        this.email.sendRefereePayoutRequested(referee.email, referee.name, amount).catch((err) => {
            this.logger.warn(`Payout request ${request.id} recorded but the confirmation email failed: ${err}`);
        });

        return this.mapPayoutRequest(request);
    }

    /** A partner withdrawing their own request. Only while nobody has acted on it. */
    async cancelPayoutRequest(refereeId: string, requestId: string) {
        const request = await this.db.refereePayoutRequest.findFirst({
            where: { id: requestId, referee_id: refereeId },
        });
        if (!request) throw new NotFoundException('Payout request not found');
        if (request.status !== 'PENDING') {
            throw new BadRequestException('Only a request that is still awaiting review can be cancelled');
        }

        const updated = await this.db.refereePayoutRequest.update({
            where: { id: requestId },
            data: { status: 'CANCELLED', reviewed_at: new Date() },
        });
        return this.mapPayoutRequest(updated);
    }

    // ── Payouts: admin side ───────────────────────────────────────────────────

    async listAllPayoutRequests(query: ListPayoutRequestsQueryDto = {}) {
        const requests = await this.db.refereePayoutRequest.findMany({
            where: {
                ...(query.status && { status: query.status }),
                ...(query.referee_id && { referee_id: query.referee_id }),
            },
            orderBy: [{ status: 'asc' }, { requested_at: 'desc' }],
            include: {
                referee: { select: { id: true, name: true, email: true, referral_code: true } },
            },
        });

        return requests.map((r) => ({
            ...this.mapPayoutRequest(r),
            referee: r.referee,
        }));
    }

    /**
     * Approve a request. This moves no money and settles no commission — it tells
     * the partner their request cleared review and a transfer is being made. The
     * ledger changes when `recordPayment` runs against the request.
     */
    async approvePayoutRequest(requestId: string, adminUserId: string) {
        const request = await this.db.refereePayoutRequest.findUnique({
            where: { id: requestId },
            include: { referee: { select: { name: true, email: true } } },
        });
        if (!request) throw new NotFoundException('Payout request not found');
        if (request.status !== 'PENDING') {
            throw new BadRequestException(`This request is already ${request.status.toLowerCase()}`);
        }

        const updated = await this.db.refereePayoutRequest.update({
            where: { id: requestId },
            data: { status: 'APPROVED', reviewed_at: new Date(), reviewed_by: adminUserId },
        });

        this.email
            .sendRefereePayoutApproved(request.referee.email, request.referee.name, Number(request.amount))
            .catch((err) => {
                this.logger.warn(`Payout request ${requestId} approved but the notification email failed: ${err}`);
            });

        return this.mapPayoutRequest(updated);
    }

    async rejectPayoutRequest(requestId: string, reason: string, adminUserId: string) {
        const request = await this.db.refereePayoutRequest.findUnique({
            where: { id: requestId },
            include: { referee: { select: { name: true, email: true } } },
        });
        if (!request) throw new NotFoundException('Payout request not found');
        if (request.status === 'PAID') {
            throw new BadRequestException('This request has already been paid');
        }
        if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
            throw new BadRequestException(`This request is already ${request.status.toLowerCase()}`);
        }

        const updated = await this.db.refereePayoutRequest.update({
            where: { id: requestId },
            data: {
                status: 'REJECTED',
                decision_note: reason.trim(),
                reviewed_at: new Date(),
                reviewed_by: adminUserId,
            },
        });

        this.email
            .sendRefereePayoutRejected(
                request.referee.email,
                request.referee.name,
                Number(request.amount),
                reason,
            )
            .catch((err) => {
                this.logger.warn(`Payout request ${requestId} rejected but the notification email failed: ${err}`);
            });

        return this.mapPayoutRequest(updated);
    }

    private mapPayoutRequest(r: any) {
        return {
            id: r.id,
            referee_id: r.referee_id,
            amount: Number(r.amount),
            status: r.status,
            method: r.method,
            account_name: r.account_name,
            account_number: r.account_number,
            bank_name: r.bank_name,
            branch: r.branch,
            note: r.note,
            decision_note: r.decision_note,
            requested_at: r.requested_at,
            reviewed_at: r.reviewed_at,
            payment_id: r.payment_id,
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Post a referee payout as a journal voucher in the platform's own books.
     *
     * `RefereePayment` is a platform-level ledger with no link into the accounting
     * module, so commission expense never appeared in the operator's P&L. The
     * accounting module is tenant-scoped and the platform is not a tenant, which is
     * why the target workspace and both accounts have to be configured rather than
     * inferred — guessing an account is worse than not posting.
     *
     * No-ops unless `referral_accounting` is fully configured, so this is off until
     * someone deliberately turns it on.
     */
    private async postCommissionExpense(
        paymentId: string,
        refereeName: string,
        amount: number,
        reference?: string,
    ): Promise<void> {
        const settings = await this.platformSettings.getRawGroup('referral_accounting');
        if (settings.enabled !== 'true') return;

        const { house_tenant_id: tenantId, expense_account_id, payment_account_id } = settings;
        if (!tenantId || !expense_account_id || !payment_account_id) {
            this.logger.warn(
                'referral_accounting is enabled but incompletely configured; skipping the posting. '
                + 'Set house_tenant_id, expense_account_id and payment_account_id.',
            );
            return;
        }

        await this.accounting.createVoucher(tenantId, {
            voucherType: 'JOURNAL' as any,
            description: `Referral commission payout — ${refereeName}`,
            referenceNumber: reference || `referee-payment:${paymentId}`,
            details: [
                { accountId: expense_account_id, debitAmount: amount, creditAmount: 0 },
                { accountId: payment_account_id, debitAmount: 0, creditAmount: amount },
            ],
        } as any);
    }

    /** Money is compared and stored to two decimals; float sums drift without this. */
    private round2(value: number): number {
        return Math.round(value * 100) / 100;
    }

    private normalizeReferralCode(code: string): string {
        return code.trim().toUpperCase();
    }

    private generateReferralCode(name: string): string {
        const base = name.replace(/\s+/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
        const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
        return `${base}${suffix}`;
    }

    private mapSignup(s: any) {
        return {
            id: s.id,
            referee_id: s.referee_id,
            referee: s.referee ?? undefined,
            tenant_id: s.tenant_id,
            tenant: s.tenant ?? undefined,
            discount_pct: Number(s.discount_pct),
            commission_pct: Number(s.commission_pct),
            plan_amount: s.plan_amount !== null ? Number(s.plan_amount) : null,
            commission_amount: s.commission_amount !== null ? Number(s.commission_amount) : null,
            status: s.status,
            signed_up_at: s.signed_up_at,
            earned_at: s.earned_at,
            paid_at: s.paid_at,
            reversed_at: s.reversed_at ?? null,
            reversal_reason: s.reversal_reason ?? null,
            reversed_after_paid: s.reversed_after_paid ?? false,
            referee_payment_id: s.referee_payment_id,
        };
    }

    private mapPayment(p: any) {
        return {
            id: p.id,
            referee_id: p.referee_id,
            amount: Number(p.amount),
            method: p.method,
            reference: p.reference,
            notes: p.notes,
            paid_at: p.paid_at,
            created_by: p.created_by,
            created_at: p.created_at,
        };
    }
}
