import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AccountingService } from '../accounting/accounting.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PasswordResetService } from '../password-reset/password-reset.service';
import {
    CreateRefereeDto,
    ListCommissionsQueryDto,
    ListRefereesQueryDto,
    RecordPaymentDto,
    TrackClickDto,
    UpdateRefereeDto,
} from './referrals.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';

/** Matches the cap in ListCommissionsQueryDto; kept here so the service has a default of its own. */
const DEFAULT_COMMISSION_PAGE_SIZE = 50;

@Injectable()
export class ReferralsService {
    private readonly logger = new Logger(ReferralsService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly passwordReset: PasswordResetService,
        private readonly email: EmailService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly accounting: AccountingService,
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

        await this.passwordReset.requestRefereeInvite(user.email, referee.name, referee.referral_code);
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
            select: { id: true, name: true, email: true, referral_code: true, deleted_at: true },
        });
        if (!referee) throw new NotFoundException('Referee not found');

        const [commissions, payments, clicks] = await Promise.all([
            this.db.referralSignup.findMany({
                where: { referee_id: refereeId },
                orderBy: { signed_up_at: 'desc' },
                include: { tenant: { select: { id: true, name: true } } },
            }),
            this.db.refereePayment.findMany({
                where: { referee_id: refereeId },
                orderBy: { paid_at: 'desc' },
            }),
            this.db.referralClick.count({ where: { referee_id: refereeId } }),
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
            referee,
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
            commissions: commissions.map(this.mapSignup),
            payments: payments.map(this.mapPayment),
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
