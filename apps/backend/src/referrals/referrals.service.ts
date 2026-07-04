import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PasswordResetService } from '../password-reset/password-reset.service';
import { CreateRefereeDto, ListCommissionsQueryDto, RecordPaymentDto, UpdateRefereeDto } from './referrals.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';

@Injectable()
export class ReferralsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly passwordReset: PasswordResetService,
    ) {}

    // ── Referees ──────────────────────────────────────────────────────────────

    async createReferee(dto: CreateRefereeDto, adminUserId: string) {
        const existing = await this.db.referee.findUnique({ where: { email: dto.email } });
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

    private mapReferee(r: any) {
        return {
            ...r,
            commission_rate: Number(r.commission_rate),
            signup_discount: Number(r.signup_discount),
        };
    }

    async listReferees() {
        const referees = await this.db.referee.findMany({
            orderBy: { created_at: 'desc' },
            include: {
                _count: { select: { referralSignups: true } },
            },
        });

        return Promise.all(referees.map(async (r) => {
            const [pending, earned, paid] = await Promise.all([
                this.db.referralSignup.count({ where: { referee_id: r.id, status: 'PENDING' } }),
                this.db.referralSignup.aggregate({ where: { referee_id: r.id, status: 'EARNED' }, _sum: { commission_amount: true }, _count: true }),
                this.db.referralSignup.aggregate({ where: { referee_id: r.id, status: 'PAID' }, _sum: { commission_amount: true }, _count: true }),
            ]);
            return {
                ...this.mapReferee(r),
                stats: {
                    pending_signups: pending,
                    earned_count: earned._count,
                    earned_amount: Number(earned._sum.commission_amount ?? 0),
                    paid_count: paid._count,
                    paid_amount: Number(paid._sum.commission_amount ?? 0),
                },
            };
        }));
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

        if (dto.email && dto.email !== referee.email) {
            const conflict = await this.db.referee.findUnique({ where: { email: dto.email } });
            if (conflict) throw new ConflictException('Email already in use by another referee');
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
            },
        });

        return this.mapReferee(updated);
    }

    // ── Commissions ───────────────────────────────────────────────────────────

    async listCommissions(query: ListCommissionsQueryDto) {
        const commissions = await this.db.referralSignup.findMany({
            where: {
                ...(query.referee_id && { referee_id: query.referee_id }),
                ...(query.status && { status: query.status }),
            },
            orderBy: { signed_up_at: 'desc' },
            include: {
                referee: { select: { id: true, name: true, email: true, referral_code: true } },
                tenant: { select: { id: true, name: true } },
            },
        });

        return commissions.map(this.mapSignup);
    }

    // ── Payments ──────────────────────────────────────────────────────────────

    async recordPayment(refereeId: string, dto: RecordPaymentDto, adminUserId: string) {
        const referee = await this.db.referee.findUnique({ where: { id: refereeId } });
        if (!referee) throw new NotFoundException('Referee not found');

        const earned = await this.db.referralSignup.findMany({
            where: { referee_id: refereeId, status: 'EARNED' },
        });
        if (earned.length === 0) throw new BadRequestException('No earned commissions to pay');

        const ids = dto.commission_ids?.length
            ? dto.commission_ids
            : earned.map((s) => s.id);

        const toMark = earned.filter((s) => ids.includes(s.id));
        if (toMark.length === 0) throw new BadRequestException('No matching earned commissions found');

        const payment = await this.db.$transaction(async (tx) => {
            const newPayment = await tx.refereePayment.create({
                data: {
                    referee_id: refereeId,
                    amount: dto.amount,
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
            select: { id: true, name: true, email: true, referral_code: true },
        });
        if (!referee) throw new NotFoundException('Referee not found');

        const [commissions, payments] = await Promise.all([
            this.db.referralSignup.findMany({
                where: { referee_id: refereeId },
                orderBy: { signed_up_at: 'desc' },
                include: { tenant: { select: { id: true, name: true } } },
            }),
            this.db.refereePayment.findMany({
                where: { referee_id: refereeId },
                orderBy: { paid_at: 'desc' },
            }),
        ]);

        const totalEarned = commissions
            .filter((c) => c.status === 'EARNED' || c.status === 'PAID')
            .reduce((sum, c) => sum + Number(c.commission_amount ?? 0), 0);
        const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);

        return {
            referee,
            summary: {
                total_referrals: commissions.length,
                pending: commissions.filter((c) => c.status === 'PENDING').length,
                earned: commissions.filter((c) => c.status === 'EARNED').length,
                paid: commissions.filter((c) => c.status === 'PAID').length,
                total_earned_amount: totalEarned,
                total_paid_amount: totalPaid,
                balance_due: Math.max(0, totalEarned - totalPaid),
            },
            commissions: commissions.map(this.mapSignup),
            payments: payments.map(this.mapPayment),
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
