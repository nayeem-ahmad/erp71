import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { AccountingService } from '../accounting/accounting.service';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { classifyPaymentMode } from '../sales/classify-payment-mode';
import {
    CreateCapitalTxnDto,
    CreateInvestorDto,
    ListInvestorsQueryDto,
    ListProfitRunsQueryDto,
    PayProfitShareDto,
    ProfitRunDto,
    UpdateInvestorDto,
} from './investors.dto';
import {
    AllocationLine,
    allocateProfit,
    monthBounds,
    roundAmount,
} from './profit-allocation.util';

@Injectable()
export class InvestorsService {
    constructor(
        private db: DatabaseService,
        private accounting: AccountingService,
    ) {}

    // ── Investors ────────────────────────────────────────────────────────────

    async list(tenantId: string, query: ListInvestorsQueryDto): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const where: Prisma.InvestorWhereInput = { tenant_id: tenantId };
        if (query.status) where.status = query.status;
        if (query.storeId) where.store_id = query.storeId;
        if (query.search?.trim()) {
            where.name = { contains: query.search.trim(), mode: 'insensitive' };
        }

        const [items, total] = await Promise.all([
            this.db.investor.findMany({
                where,
                include: {
                    store: { select: { id: true, name: true } },
                    capitalTxns: { select: { direction: true, amount: true } },
                    profitShares: { select: { amount: true, paid_amount: true, status: true } },
                },
                orderBy: [{ status: 'asc' }, { name: 'asc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.investor.count({ where }),
        ]);

        return paginate(items.map((investor) => this.withTotals(investor)), total, page, limit);
    }

    async get(tenantId: string, id: string) {
        const investor = await this.db.investor.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                store: { select: { id: true, name: true } },
                capitalTxns: { orderBy: { txn_date: 'desc' } },
                profitShares: {
                    orderBy: { created_at: 'desc' },
                    include: {
                        run: { select: { id: true, year: true, month: true, status: true, profit_basis_amount: true } },
                    },
                },
            },
        });
        if (!investor) {
            throw new NotFoundException('Investor not found.');
        }
        return this.withTotals(investor);
    }

    async create(tenantId: string, userId: string, dto: CreateInvestorDto) {
        if (dto.storeId) await this.assertStoreExists(tenantId, dto.storeId);
        await this.assertShareBudget(tenantId, dto.profitSharePct, null);

        const investor = await this.db.investor.create({
            data: {
                tenant_id: tenantId,
                store_id: dto.storeId ?? null,
                name: dto.name.trim(),
                phone: dto.phone?.trim() || null,
                email: dto.email?.trim() || null,
                national_id: dto.nationalId?.trim() || null,
                profit_share_pct: dto.profitSharePct,
                joined_on: new Date(dto.joinedOn),
                notes: dto.notes?.trim() || null,
                created_by: userId,
            },
        });

        return this.get(tenantId, investor.id);
    }

    async update(tenantId: string, id: string, dto: UpdateInvestorDto) {
        const existing = await this.assertInvestorExists(tenantId, id);
        if (dto.storeId) await this.assertStoreExists(tenantId, dto.storeId);

        // Only an investor who will still be ACTIVE competes for the 100% budget.
        const nextStatus = dto.status ?? existing.status;
        const nextPct = dto.profitSharePct ?? Number(existing.profit_share_pct);
        if (nextStatus === 'ACTIVE') {
            await this.assertShareBudget(tenantId, nextPct, id);
        }

        await this.db.investor.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
                ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
                ...(dto.nationalId !== undefined ? { national_id: dto.nationalId?.trim() || null } : {}),
                ...(dto.profitSharePct !== undefined ? { profit_share_pct: dto.profitSharePct } : {}),
                ...(dto.joinedOn !== undefined ? { joined_on: new Date(dto.joinedOn) } : {}),
                ...(dto.exitedOn !== undefined
                    ? { exited_on: dto.exitedOn ? new Date(dto.exitedOn) : null }
                    : {}),
                ...(dto.storeId !== undefined ? { store_id: dto.storeId } : {}),
                ...(dto.status !== undefined ? { status: dto.status } : {}),
                ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            },
        });

        return this.get(tenantId, id);
    }

    /**
     * Deleting an investor would cascade away their capital and profit-share
     * rows while the vouchers those rows posted stay in the ledger — the GL would
     * still carry Investor Capital and Investor Profit Payable balances with
     * nothing left to attribute them to. Anyone who has transacted is retired via
     * status instead.
     */
    async remove(tenantId: string, id: string) {
        await this.assertInvestorExists(tenantId, id);

        const [capitalCount, shareCount] = await Promise.all([
            this.db.investorCapitalTxn.count({ where: { tenant_id: tenantId, investor_id: id } }),
            this.db.investorProfitShare.count({ where: { tenant_id: tenantId, investor_id: id } }),
        ]);
        if (capitalCount > 0 || shareCount > 0) {
            throw new BadRequestException(
                'INVESTOR_HAS_LEDGER_HISTORY: mark the investor as EXITED instead of deleting.',
            );
        }

        return this.db.investor.delete({ where: { id } });
    }

    // ── Capital in / out ─────────────────────────────────────────────────────

    async addCapitalTxn(tenantId: string, userId: string, investorId: string, dto: CreateCapitalTxnDto) {
        const investor = await this.assertInvestorExists(tenantId, investorId);
        const direction = dto.direction ?? 'CONTRIBUTION';
        const paymentMethod = dto.paymentMethod ?? 'CASH';

        if (direction === 'WITHDRAWAL') {
            const balance = await this.capitalBalance(tenantId, investorId);
            if (dto.amount > balance + 0.005) {
                throw new BadRequestException(
                    `Withdrawal exceeds the investor's capital balance (${balance.toFixed(2)}).`,
                );
            }
        }

        await this.db.$transaction(async (tx) => {
            const txn = await tx.investorCapitalTxn.create({
                data: {
                    tenant_id: tenantId,
                    investor_id: investorId,
                    direction,
                    amount: dto.amount,
                    txn_date: new Date(dto.txnDate),
                    payment_method: paymentMethod,
                    reference: dto.reference?.trim() || null,
                    notes: dto.notes?.trim() || null,
                    created_by: userId,
                },
            });

            await autoPostFromRules({
                tx,
                tenantId,
                eventType: direction === 'WITHDRAWAL' ? 'investor_withdrawal' : 'investor_contribution',
                conditionKey: 'payment_mode',
                conditionValue: classifyPaymentMode(paymentMethod),
                sourceModule: 'investors',
                sourceType: 'investor_capital_txn',
                sourceId: txn.id,
                amount: dto.amount,
                description: `Investor ${direction === 'WITHDRAWAL' ? 'capital withdrawal' : 'capital contribution'} — ${investor.name}`,
                referenceNumber: txn.reference ?? undefined,
                date: txn.txn_date,
                storeId: investor.store_id ?? undefined,
            });
        });

        return this.get(tenantId, investorId);
    }

    async deleteCapitalTxn(tenantId: string, investorId: string, txnId: string) {
        await this.assertInvestorExists(tenantId, investorId);
        const txn = await this.db.investorCapitalTxn.findFirst({
            where: { id: txnId, investor_id: investorId, tenant_id: tenantId },
        });
        if (!txn) {
            throw new NotFoundException('Capital transaction not found.');
        }

        await this.db.$transaction(async (tx) => {
            await voidAutoPostedVoucher(
                tx,
                tenantId,
                txn.direction === 'WITHDRAWAL' ? 'investor_withdrawal' : 'investor_contribution',
                txn.id,
            );
            await tx.investorCapitalTxn.delete({ where: { id: txnId } });
        });

        return this.get(tenantId, investorId);
    }

    // ── Monthly profit runs ──────────────────────────────────────────────────

    /**
     * What a run for this month WOULD allocate, without writing anything.
     *
     * The profit basis is a live read here and a snapshot once the run posts —
     * that difference is the point of the preview.
     */
    async previewProfitRun(tenantId: string, dto: ProfitRunDto) {
        const { profit, from, to } = await this.readMonthProfit(tenantId, dto);
        const investors = await this.eligibleInvestors(tenantId, dto);
        const lines = allocateProfit(profit, investors.map((investor) => this.toAllocationInvestor(investor)));
        const existing = await this.findRun(tenantId, dto);

        return {
            year: dto.year,
            month: dto.month,
            store_id: dto.storeId ?? null,
            basis_type: dto.basisType ?? 'NET_PROFIT',
            period: { from, to },
            profit_basis_amount: profit,
            already_run: Boolean(existing),
            run_id: existing?.id ?? null,
            lines: lines.map((line) => this.decorateLine(line, investors)),
            total_accrued: roundAmount(lines.reduce((sum, line) => sum + line.amount, 0)),
        };
    }

    /**
     * Computes, records and posts one month's profit share.
     *
     * Idempotency is structural: InvestorProfitRun is unique on
     * (tenant, year, month, store), so a second call for the same month is
     * rejected rather than double-accruing. Posting is dated to the period end so
     * autoPostFromRules' fiscal-period guard blocks accruing into a locked month.
     */
    async createProfitRun(tenantId: string, userId: string, dto: ProfitRunDto) {
        if (dto.storeId) await this.assertStoreExists(tenantId, dto.storeId);

        const existing = await this.findRun(tenantId, dto);
        if (existing) {
            throw new BadRequestException(
                `PROFIT_RUN_EXISTS: ${dto.year}-${String(dto.month).padStart(2, '0')} has already been run.`,
            );
        }

        const { profit, end } = await this.readMonthProfit(tenantId, dto);
        const investors = await this.eligibleInvestors(tenantId, dto);
        if (investors.length === 0) {
            throw new BadRequestException('NO_ELIGIBLE_INVESTORS: no active investor covers this period.');
        }

        const lines = allocateProfit(profit, investors.map((investor) => this.toAllocationInvestor(investor)));
        const byId = new Map(investors.map((investor) => [investor.id, investor]));

        const runId = await this.db.$transaction(async (tx) => {
            const run = await tx.investorProfitRun.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId ?? null,
                    scope_key: this.scopeKey(dto.storeId),
                    year: dto.year,
                    month: dto.month,
                    profit_basis_amount: profit,
                    basis_type: dto.basisType ?? 'NET_PROFIT',
                    status: 'DRAFT',
                    notes: dto.notes?.trim() || null,
                    created_by: userId,
                },
            });

            for (const line of lines) {
                const share = await tx.investorProfitShare.create({
                    data: {
                        tenant_id: tenantId,
                        run_id: run.id,
                        investor_id: line.investorId,
                        share_pct_snapshot: line.sharePct,
                        amount: line.amount,
                        loss_applied: line.lossApplied,
                        status: 'ACCRUED',
                    },
                });

                await tx.investor.update({
                    where: { id: line.investorId },
                    data: { loss_carry_forward: line.lossCarryForwardAfter },
                });

                // A zero share (loss month, or profit fully absorbed by carried
                // losses) has nothing to declare. autoPostFromRules would skip an
                // amount <= 0 anyway; not calling it keeps the posting-exception
                // list clean of rows that are correct.
                if (line.amount <= 0) continue;

                await autoPostFromRules({
                    tx,
                    tenantId,
                    eventType: 'investor_profit_accrual',
                    conditionKey: 'none',
                    conditionValue: null,
                    sourceModule: 'investors',
                    sourceType: 'investor_profit_share',
                    sourceId: share.id,
                    amount: line.amount,
                    description: `Investor profit share ${dto.year}-${String(dto.month).padStart(2, '0')} — ${byId.get(line.investorId)?.name ?? ''}`,
                    date: end,
                    storeId: dto.storeId ?? undefined,
                    partyType: 'INVESTOR',
                    partyId: line.investorId,
                });
            }

            await tx.investorProfitRun.update({
                where: { id: run.id },
                data: { status: 'POSTED', posted_at: new Date() },
            });

            return run.id;
        });

        return this.getProfitRun(tenantId, runId);
    }

    async listProfitRuns(tenantId: string, query: ListProfitRunsQueryDto): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const where: Prisma.InvestorProfitRunWhereInput = { tenant_id: tenantId };
        if (query.year) where.year = query.year;
        if (query.storeId) where.store_id = query.storeId;

        const [items, total] = await Promise.all([
            this.db.investorProfitRun.findMany({
                where,
                include: {
                    store: { select: { id: true, name: true } },
                    shares: { select: { amount: true, paid_amount: true, status: true } },
                },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.investorProfitRun.count({ where }),
        ]);

        return paginate(items.map((run) => this.withRunTotals(run)), total, page, limit);
    }

    async getProfitRun(tenantId: string, id: string) {
        const run = await this.db.investorProfitRun.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                store: { select: { id: true, name: true } },
                shares: {
                    include: { investor: { select: { id: true, name: true } } },
                    orderBy: { amount: 'desc' },
                },
            },
        });
        if (!run) {
            throw new NotFoundException('Profit run not found.');
        }
        return this.withRunTotals(run);
    }

    /**
     * Undoes a run: voids its accrual vouchers, restores the carry-forward each
     * share moved, and drops the run. Refused once any share has been paid —
     * cash has left the business at that point and the correction belongs in a
     * manual voucher, not a silent rewrite of history.
     */
    async deleteProfitRun(tenantId: string, id: string) {
        const run = await this.db.investorProfitRun.findFirst({
            where: { id, tenant_id: tenantId },
            include: { shares: true },
        });
        if (!run) {
            throw new NotFoundException('Profit run not found.');
        }
        if (run.shares.some((share) => share.status === 'PAID')) {
            throw new BadRequestException('PROFIT_RUN_HAS_PAYOUTS: a run with paid shares cannot be deleted.');
        }

        await this.db.$transaction(async (tx) => {
            for (const share of run.shares) {
                await voidAutoPostedVoucher(tx, tenantId, 'investor_profit_accrual', share.id);
                // Reverse this run's movement so a re-run starts from the same
                // carry-forward the original one saw.
                await tx.investor.update({
                    where: { id: share.investor_id },
                    data: { loss_carry_forward: { decrement: share.loss_applied } },
                });
            }
            await tx.investorProfitRun.delete({ where: { id } });
        });

        return { id, deleted: true };
    }

    // ── Payouts ──────────────────────────────────────────────────────────────

    /**
     * Settles one month's accrued share in cash, in full.
     *
     * Full settlement rather than partial: the payout's idempotency key is
     * derived from the share id, so two partial payments against one share would
     * collide on it. A month's share is declared as a unit and settled as a unit;
     * anything else is a manual voucher.
     */
    async payShare(tenantId: string, shareId: string, dto: PayProfitShareDto) {
        const share = await this.db.investorProfitShare.findFirst({
            where: { id: shareId, tenant_id: tenantId },
            include: { investor: true, run: true },
        });
        if (!share) {
            throw new NotFoundException('Profit share not found.');
        }
        if (share.status === 'PAID') {
            throw new BadRequestException('PROFIT_SHARE_ALREADY_PAID');
        }
        const amount = Number(share.amount);
        if (amount <= 0) {
            throw new BadRequestException('PROFIT_SHARE_ZERO: nothing was accrued for this month.');
        }

        const paymentMethod = dto.paymentMethod ?? 'CASH';

        await this.db.$transaction(async (tx) => {
            await tx.investorProfitShare.update({
                where: { id: shareId },
                data: { status: 'PAID', paid_amount: amount },
            });

            await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'investor_profit_payout',
                conditionKey: 'payment_mode',
                conditionValue: classifyPaymentMode(paymentMethod),
                sourceModule: 'investors',
                sourceType: 'investor_profit_share',
                sourceId: share.id,
                amount,
                description: `Investor profit payout ${share.run.year}-${String(share.run.month).padStart(2, '0')} — ${share.investor.name}`,
                date: new Date(dto.paymentDate),
                storeId: share.run.store_id ?? undefined,
                partyType: 'INVESTOR',
                partyId: share.investor_id,
            });
        });

        return this.get(tenantId, share.investor_id);
    }

    // ── Summary ──────────────────────────────────────────────────────────────

    async getSummary(tenantId: string) {
        const [investors, shares] = await Promise.all([
            this.db.investor.findMany({
                where: { tenant_id: tenantId },
                include: { capitalTxns: { select: { direction: true, amount: true } } },
            }),
            this.db.investorProfitShare.findMany({
                where: { tenant_id: tenantId },
                select: { amount: true, paid_amount: true, status: true },
            }),
        ]);

        const capitalInvested = investors.reduce(
            (sum, investor) => sum + this.netCapital(investor.capitalTxns),
            0,
        );
        const accrued = shares.reduce((sum, share) => sum + Number(share.amount), 0);
        const paid = shares.reduce((sum, share) => sum + Number(share.paid_amount), 0);

        return {
            activeCount: investors.filter((investor) => investor.status === 'ACTIVE').length,
            exitedCount: investors.filter((investor) => investor.status !== 'ACTIVE').length,
            capitalInvested: roundAmount(capitalInvested),
            totalSharePct: roundAmount(
                investors
                    .filter((investor) => investor.status === 'ACTIVE')
                    .reduce((sum, investor) => sum + Number(investor.profit_share_pct), 0),
            ),
            profitAccrued: roundAmount(accrued),
            profitPaid: roundAmount(paid),
            profitOutstanding: roundAmount(accrued - paid),
        };
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /**
     * The month's net profit, read through the same code that renders the P&L
     * report so the two can never disagree.
     *
     * `hasConsolidatedAccess` is true because the caller has already cleared
     * MANAGE_INVESTORS on the controller — this is a server-side read, not a
     * user-supplied report scope.
     */
    private async readMonthProfit(tenantId: string, dto: ProfitRunDto) {
        const { from, to, end } = monthBounds(dto.year, dto.month);
        const report = await this.accounting.getProfitLoss(
            tenantId,
            dto.storeId
                ? { from, to, scope: 'branch', storeId: dto.storeId }
                : { from, to, scope: 'company' },
            true,
        );
        return { profit: roundAmount(Number((report as { net_profit: number }).net_profit ?? 0)), from, to, end };
    }

    /**
     * Investors entitled to a share of this month: active for at least part of
     * the period, and matching the run's scope. A company-wide run includes the
     * store-tied investors too — their agreement is a share of profit, and the
     * company figure contains their branch.
     */
    private async eligibleInvestors(tenantId: string, dto: ProfitRunDto) {
        const { from, to } = monthBounds(dto.year, dto.month);
        return this.db.investor.findMany({
            where: {
                tenant_id: tenantId,
                status: 'ACTIVE',
                joined_on: { lte: new Date(to) },
                OR: [{ exited_on: null }, { exited_on: { gte: new Date(from) } }],
                ...(dto.storeId ? { store_id: dto.storeId } : {}),
            },
            orderBy: { name: 'asc' },
        });
    }

    private toAllocationInvestor(investor: { id: string; profit_share_pct: unknown; loss_carry_forward: unknown }) {
        return {
            investorId: investor.id,
            sharePct: Number(investor.profit_share_pct),
            lossCarryForward: Number(investor.loss_carry_forward),
        };
    }

    private decorateLine(line: AllocationLine, investors: { id: string; name: string }[]) {
        return { ...line, name: investors.find((investor) => investor.id === line.investorId)?.name ?? '' };
    }

    /** The non-null uniqueness discriminator — see InvestorProfitRun.scope_key. */
    private scopeKey(storeId?: string | null) {
        return storeId ?? 'COMPANY';
    }

    private async findRun(tenantId: string, dto: ProfitRunDto) {
        return this.db.investorProfitRun.findUnique({
            where: {
                tenant_id_year_month_scope_key: {
                    tenant_id: tenantId,
                    year: dto.year,
                    month: dto.month,
                    scope_key: this.scopeKey(dto.storeId),
                },
            },
        });
    }

    /**
     * Active investors cannot be promised more than 100% of profit between them.
     * Caught here rather than at run time, when the over-allocation would already
     * have posted vouchers.
     */
    private async assertShareBudget(tenantId: string, pct: number, excludeId: string | null) {
        const others = await this.db.investor.findMany({
            where: {
                tenant_id: tenantId,
                status: 'ACTIVE',
                ...(excludeId ? { id: { not: excludeId } } : {}),
            },
            select: { profit_share_pct: true },
        });

        const committed = others.reduce((sum, investor) => sum + Number(investor.profit_share_pct), 0);
        if (roundAmount(committed + pct) > 100) {
            throw new BadRequestException(
                `SHARE_BUDGET_EXCEEDED: active investors already hold ${committed.toFixed(2)}% of profit.`,
            );
        }
    }

    private netCapital(txns: { direction: string; amount: unknown }[]) {
        return txns.reduce(
            (sum, txn) => sum + (txn.direction === 'WITHDRAWAL' ? -Number(txn.amount) : Number(txn.amount)),
            0,
        );
    }

    private async capitalBalance(tenantId: string, investorId: string) {
        const txns = await this.db.investorCapitalTxn.findMany({
            where: { tenant_id: tenantId, investor_id: investorId },
            select: { direction: true, amount: true },
        });
        return roundAmount(this.netCapital(txns));
    }

    private withTotals(investor: any) {
        const capital = Array.isArray(investor.capitalTxns) ? this.netCapital(investor.capitalTxns) : 0;
        const shares = Array.isArray(investor.profitShares) ? investor.profitShares : [];
        const accrued = shares.reduce((sum: number, share: any) => sum + Number(share.amount), 0);
        const paid = shares.reduce((sum: number, share: any) => sum + Number(share.paid_amount), 0);

        return {
            ...investor,
            capital_balance: roundAmount(capital),
            profit_accrued: roundAmount(accrued),
            profit_paid: roundAmount(paid),
            profit_outstanding: roundAmount(accrued - paid),
        };
    }

    private withRunTotals(run: any) {
        const shares = Array.isArray(run.shares) ? run.shares : [];
        const accrued = shares.reduce((sum: number, share: any) => sum + Number(share.amount), 0);
        const paid = shares.reduce((sum: number, share: any) => sum + Number(share.paid_amount), 0);

        return {
            ...run,
            total_accrued: roundAmount(accrued),
            total_paid: roundAmount(paid),
            total_outstanding: roundAmount(accrued - paid),
        };
    }

    private async assertInvestorExists(tenantId: string, id: string) {
        const investor = await this.db.investor.findFirst({ where: { id, tenant_id: tenantId } });
        if (!investor) {
            throw new NotFoundException('Investor not found.');
        }
        return investor;
    }

    private async assertStoreExists(tenantId: string, storeId: string) {
        const store = await this.db.store.findFirst({ where: { id: storeId, tenant_id: tenantId } });
        if (!store) {
            throw new NotFoundException('Store not found.');
        }
        return store;
    }
}
