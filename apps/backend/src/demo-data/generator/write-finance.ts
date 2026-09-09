import { Prisma } from '@prisma/client';
import { AccountType } from '../../accounting/accounting.constants';
import { autoPostFromRules } from '../../accounting/posting.utils';
import type { DemoWorld } from './context';
import { personName } from './people';
import { money } from './write';

type Tx = Prisma.TransactionClient;

interface AssetRuntime {
    id: string;
    name: string;
    cost: number;
    residual: number;
    usefulLifeMonths: number;
    accumulated: number;
    purchasedAt: Date;
}

interface LoanRuntime {
    id: string;
    counterparty: string;
    direction: 'PAYABLE' | 'RECEIVABLE';
    principal: number;
    outstanding: number;
}

interface InvestorRuntime {
    id: string;
    name: string;
    sharePct: number;
}

const ASSET_SPECS = [
    { name: 'Delivery van', cost: 1_450_000, lifeMonths: 84, mode: 'bank' },
    { name: 'Shop refrigeration unit', cost: 210_000, lifeMonths: 60, mode: 'bank' },
    { name: 'POS terminals and printers', cost: 96_000, lifeMonths: 36, mode: 'cash' },
    { name: 'Shelving and shop fit-out', cost: 320_000, lifeMonths: 60, mode: 'bank' },
];

const COST_CENTRES = [
    { code: 'CC-MAIN', name: 'Main branch' },
    { code: 'CC-BR2', name: 'Second branch' },
    { code: 'CC-ADMIN', name: 'Head office' },
    { code: 'CC-DELIV', name: 'Delivery fleet' },
];

/**
 * The financing and asset side of the books: what the shop owns and depreciates,
 * what it has borrowed, who put capital in, how cash moves between branches, and
 * the fiscal periods and budgets the accounting module needs to have something
 * to close and compare against.
 *
 * Every one of these posts through the tenant's own rules, so the balance sheet
 * that comes out is derived rather than asserted — the same property that makes
 * the core trading data trustworthy.
 */
export class FinanceWriter {
    private assets: AssetRuntime[] = [];
    private loans: LoanRuntime[] = [];
    private investors: InvestorRuntime[] = [];

    constructor(private readonly world: DemoWorld) {}

    private get counts() {
        return this.world.counts;
    }

    /* ---------------------------------------------------------------- */
    /*  Setup                                                            */
    /* ---------------------------------------------------------------- */

    /** Cost centres, unlocked fiscal periods, and a budget per expense account. */
    async ensureAccountingScaffolding(tx: Tx): Promise<void> {
        const { tenantId, rng } = this.world;

        for (const centre of COST_CENTRES) {
            await tx.costCenter.upsert({
                where: { tenant_id_code: { tenant_id: tenantId, code: centre.code } },
                update: {},
                create: { tenant_id: tenantId, code: centre.code, name: centre.name, is_active: true },
            });
            this.counts.costCenters++;
        }

        // One period per month in the window, all open. Locking is a demo action,
        // not something the generator should decide — a locked period would also
        // refuse every posting dated inside it.
        for (const { year, month } of this.monthsInWindow()) {
            const start = new Date(Date.UTC(year, month - 1, 1));
            const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
            await tx.fiscalPeriod.upsert({
                where: { tenant_id_year_month: { tenant_id: tenantId, year, month } },
                update: {},
                create: {
                    tenant_id: tenantId, year, month,
                    period_label: `${year}-${String(month).padStart(2, '0')}`,
                    start_date: start, end_date: end, is_locked: false,
                },
            });
        }

        const expenseAccounts = await tx.account.findMany({
            where: { tenant_id: tenantId, type: AccountType.EXPENSE },
            select: { id: true, name: true },
            take: 8,
        });
        for (const account of expenseAccounts) {
            for (const { year, month } of this.monthsInWindow()) {
                await tx.accountBudget.upsert({
                    where: {
                        tenant_id_account_id_fiscal_year_month: {
                            tenant_id: tenantId, account_id: account.id, fiscal_year: year, month,
                        },
                    },
                    update: {},
                    create: {
                        tenant_id: tenantId, account_id: account.id,
                        fiscal_year: year, month, amount: money(rng.int(15, 120) * 1000),
                    },
                });
                this.counts.budgets++;
            }
        }
    }

    private monthsInWindow(): Array<{ year: number; month: number }> {
        const months: Array<{ year: number; month: number }> = [];
        const cursor = new Date(Date.UTC(this.world.start.getUTCFullYear(), this.world.start.getUTCMonth(), 1));
        while (cursor <= this.world.end) {
            months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
        return months;
    }

    /* ---------------------------------------------------------------- */
    /*  Fixed assets                                                     */
    /* ---------------------------------------------------------------- */

    /** Buy the shop's fixed assets on day one, posting each acquisition. */
    async acquireAssets(tx: Tx, date: Date): Promise<void> {
        for (const [index, spec] of ASSET_SPECS.entries()) {
            const assetCode = this.world.ref('FA');
            const residual = money(spec.cost * 0.1);
            const asset = await tx.fixedAsset.create({
                data: {
                    tenant_id: this.world.tenantId,
                    asset_code: assetCode,
                    name: spec.name,
                    purchase_date: date,
                    cost: spec.cost,
                    residual_value: residual,
                    useful_life_months: spec.lifeMonths,
                    depreciation_method: index === 0 ? 'DECLINING_BALANCE' : 'STRAIGHT_LINE',
                    is_active: true,
                    created_at: date,
                    updated_at: date,
                },
            });
            this.counts.fixedAssets++;

            await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'asset_acquisition',
                conditionKey: 'payment_mode',
                conditionValue: spec.mode,
                sourceModule: 'accounting',
                sourceType: 'fixed_asset',
                sourceId: asset.id,
                amount: spec.cost,
                description: `Acquired ${spec.name}`,
                referenceNumber: assetCode,
                date,
                storeId: this.world.mainStore.storeId,
            });

            this.assets.push({
                id: asset.id, name: spec.name, cost: spec.cost, residual,
                usefulLifeMonths: spec.lifeMonths, accumulated: 0, purchasedAt: date,
            });
        }
    }

    /** Straight-line depreciation for one month, posted per asset. */
    async runDepreciation(tx: Tx, date: Date, year: number, month: number): Promise<void> {
        for (const asset of this.assets) {
            const depreciable = asset.cost - asset.residual;
            if (asset.accumulated >= depreciable - 0.005) continue;
            const monthly = money(Math.min(depreciable / asset.usefulLifeMonths, depreciable - asset.accumulated));
            if (monthly <= 0.005) continue;

            const existing = await tx.assetDepreciationEntry.findUnique({
                where: { asset_id_period_year_period_month: { asset_id: asset.id, period_year: year, period_month: month } },
            });
            if (existing) continue;

            const entry = await tx.assetDepreciationEntry.create({
                data: { asset_id: asset.id, period_year: year, period_month: month, depreciation_amount: monthly, created_at: date },
            });
            const posting = await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'depreciation',
                conditionKey: 'none',
                conditionValue: null,
                sourceModule: 'accounting',
                sourceType: 'asset_depreciation',
                sourceId: entry.id,
                amount: monthly,
                description: `Depreciation ${year}-${String(month).padStart(2, '0')} — ${asset.name}`,
                date,
                storeId: this.world.mainStore.storeId,
            });
            if (posting.voucherId) {
                await tx.assetDepreciationEntry.update({ where: { id: entry.id }, data: { voucher_id: posting.voucherId } });
            }

            asset.accumulated = money(asset.accumulated + monthly);
            await tx.fixedAsset.update({
                where: { id: asset.id },
                data: { accumulated_depreciation: asset.accumulated, updated_at: date },
            });
            this.counts.depreciationEntries++;
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Loans                                                            */
    /* ---------------------------------------------------------------- */

    /** A bank loan the shop is repaying, and a smaller sum lent out. */
    async openLoans(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        const specs: Array<{ counterparty: string; direction: 'PAYABLE' | 'RECEIVABLE'; principal: number; rate: number }> = [
            { counterparty: `${rng.pick(['Janata', 'Sonali', 'BRAC', 'City'])} Bank — working capital`, direction: 'PAYABLE', principal: 800_000, rate: 9 },
            { counterparty: 'Advance to a neighbouring trader', direction: 'RECEIVABLE', principal: 150_000, rate: 0 },
        ];

        for (const spec of specs) {
            const reference = this.world.ref('LN');
            const loan = await tx.loan.create({
                data: {
                    tenant_id: this.world.tenantId,
                    store_id: this.world.mainStore.storeId,
                    counterparty: spec.counterparty,
                    direction: spec.direction,
                    principal: spec.principal,
                    interest_rate: spec.rate || null,
                    start_date: date,
                    due_date: new Date(date.getTime() + 540 * 86400000),
                    status: 'ACTIVE',
                    reference,
                    created_by: this.world.userId,
                    created_at: date,
                    updated_at: date,
                },
            });
            this.counts.loans++;

            await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'loan_disbursement',
                conditionKey: 'loan_direction',
                conditionValue: spec.direction,
                sourceModule: 'loans',
                sourceType: 'loan',
                sourceId: loan.id,
                amount: spec.principal,
                description: `Loan ${spec.direction === 'PAYABLE' ? 'received from' : 'advanced to'} ${spec.counterparty}`,
                referenceNumber: reference,
                date,
                storeId: this.world.mainStore.storeId,
            });

            this.loans.push({
                id: loan.id, counterparty: spec.counterparty, direction: spec.direction,
                principal: spec.principal, outstanding: spec.principal,
            });
        }
    }

    /** A monthly instalment against every loan still outstanding. */
    async repayLoans(tx: Tx, date: Date): Promise<void> {
        for (const loan of this.loans) {
            if (loan.outstanding <= 0.005) continue;
            const instalment = money(Math.min(loan.outstanding, loan.principal / 18));
            const payment = await tx.loanPayment.create({
                data: {
                    tenant_id: this.world.tenantId, loan_id: loan.id, amount: instalment,
                    payment_date: date, payment_method: 'BANK', notes: 'Demo instalment',
                    created_by: this.world.userId, created_at: date,
                },
            });
            this.counts.loanPayments++;

            await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'loan_repayment',
                conditionKey: 'loan_direction',
                conditionValue: loan.direction,
                sourceModule: 'loans',
                sourceType: 'loan_payment',
                sourceId: payment.id,
                amount: instalment,
                description: `Loan instalment — ${loan.counterparty}`,
                date,
                storeId: this.world.mainStore.storeId,
            });

            loan.outstanding = money(loan.outstanding - instalment);
            if (loan.outstanding <= 0.005) {
                await tx.loan.update({ where: { id: loan.id }, data: { status: 'CLOSED', updated_at: date } });
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Investors                                                        */
    /* ---------------------------------------------------------------- */

    /** Two partners with capital in the business. */
    async openInvestors(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        const shares = [18, 12];
        for (const sharePct of shares) {
            const investor = await tx.investor.create({
                data: {
                    tenant_id: this.world.tenantId,
                    store_id: this.world.mainStore.storeId,
                    name: personName(rng),
                    profit_share_pct: sharePct,
                    status: 'ACTIVE',
                    joined_on: date,
                    created_by: this.world.userId,
                    created_at: date,
                    updated_at: date,
                },
            });
            this.counts.investors++;
            this.investors.push({ id: investor.id, name: investor.name, sharePct });

            const contribution = money(sharePct * 50_000);
            await this.writeCapitalTxn(tx, date, investor.id, 'CONTRIBUTION', contribution);
        }
    }

    private async writeCapitalTxn(
        tx: Tx, date: Date, investorId: string, direction: 'CONTRIBUTION' | 'WITHDRAWAL', amount: number,
    ): Promise<void> {
        const reference = this.world.ref('INV');
        const txn = await tx.investorCapitalTxn.create({
            data: {
                tenant_id: this.world.tenantId, investor_id: investorId, direction, amount,
                txn_date: date, payment_method: 'BANK', reference,
                created_by: this.world.userId, created_at: date,
            },
        });
        this.counts.investorTransactions++;

        await autoPostFromRules({
            tx,
            tenantId: this.world.tenantId,
            eventType: direction === 'CONTRIBUTION' ? 'investor_contribution' : 'investor_withdrawal',
            conditionKey: 'payment_mode',
            conditionValue: 'bank',
            sourceModule: 'investors',
            sourceType: 'investor_capital_txn',
            sourceId: txn.id,
            amount,
            description: `Investor ${direction.toLowerCase()}`,
            referenceNumber: reference,
            date,
            storeId: this.world.mainStore.storeId,
        });
    }

    /**
     * A quarterly profit distribution: declare each investor's share against
     * Investor Profit Payable (their party ledger), then pay it out.
     */
    async runProfitDistribution(tx: Tx, date: Date, year: number, month: number): Promise<void> {
        if (this.investors.length === 0) return;
        const rng = this.world.rng;

        const existing = await tx.investorProfitRun.findFirst({
            where: { tenant_id: this.world.tenantId, year, month, scope_key: 'COMPANY' },
        });
        if (existing) return;

        const basis = money(rng.int(180, 420) * 1000);
        const run = await tx.investorProfitRun.create({
            data: {
                tenant_id: this.world.tenantId, scope_key: 'COMPANY', year, month,
                profit_basis_amount: basis, basis_type: 'NET_PROFIT', status: 'POSTED',
                posted_at: date, created_by: this.world.userId, created_at: date, updated_at: date,
            },
        });

        for (const investor of this.investors) {
            const amount = money(basis * (investor.sharePct / 100));
            const share = await tx.investorProfitShare.create({
                data: {
                    tenant_id: this.world.tenantId, run_id: run.id, investor_id: investor.id,
                    share_pct_snapshot: investor.sharePct, amount, status: 'PAID', paid_amount: amount,
                    created_at: date, updated_at: date,
                },
            });

            await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'investor_profit_accrual',
                conditionKey: 'none',
                conditionValue: null,
                sourceModule: 'investors',
                sourceType: 'investor_profit_share',
                sourceId: share.id,
                amount,
                description: `Profit share declared — ${investor.name}`,
                date,
                storeId: this.world.mainStore.storeId,
                partyType: 'INVESTOR',
                partyId: investor.id,
            });

            const paidOn = this.world.clampToWindow(new Date(date.getTime() + 3 * 86400000));
            await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'investor_profit_payout',
                conditionKey: 'payment_mode',
                conditionValue: 'bank',
                sourceModule: 'investors',
                sourceType: 'investor_profit_share',
                sourceId: share.id,
                amount,
                description: `Profit share paid — ${investor.name}`,
                date: paidOn,
                storeId: this.world.mainStore.storeId,
                partyType: 'INVESTOR',
                partyId: investor.id,
                // Same source row, second voucher — without a leg key the payout
                // would collide with the accrual's idempotency key and vanish.
                legKey: 'payout',
            });
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Inter-branch cash                                                */
    /* ---------------------------------------------------------------- */

    /** An occasional top-up or drawdown against an investor's capital. */
    async maybeCapitalMovement(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (this.investors.length === 0 || !rng.chance(0.5)) return;
        const investor = rng.pick(this.investors);
        const contribution = rng.chance(0.6);
        await this.writeCapitalTxn(
            tx, date, investor.id,
            contribution ? 'CONTRIBUTION' : 'WITHDRAWAL',
            money(rng.int(30, 150) * 1000),
        );
    }

    /** Cash sent from the branch to head office, received the same day. */
    async writeFundTransfer(tx: Tx, date: Date): Promise<void> {
        const source = this.world.secondStore;
        const destination = this.world.mainStore;
        if (!source) return;

        const amount = money(this.world.rng.int(20, 90) * 1000);
        const transfer = await tx.fundTransfer.create({
            data: {
                tenant_id: this.world.tenantId,
                source_store_id: source.storeId,
                destination_store_id: destination.storeId,
                amount,
                method: 'CASH',
                description: 'Branch cash sent to head office',
                status: 'RECEIVED',
                initiated_by: this.world.userId,
                received_by: this.world.userId,
                created_at: date,
                received_at: date,
            },
        });
        this.counts.fundTransfers++;

        const outgoing = await autoPostFromRules({
            tx,
            tenantId: this.world.tenantId,
            eventType: 'fund_transfer',
            conditionKey: 'transfer_scope',
            conditionValue: 'initiate',
            sourceModule: 'fund-transfers',
            sourceType: 'fund_transfer',
            sourceId: transfer.id,
            amount,
            description: 'Cash sent to head office',
            date,
            storeId: source.storeId,
            counterpartyStoreId: destination.storeId,
        });
        const incoming = await autoPostFromRules({
            tx,
            tenantId: this.world.tenantId,
            eventType: 'fund_transfer',
            conditionKey: 'transfer_scope',
            conditionValue: 'receive',
            sourceModule: 'fund-transfers',
            sourceType: 'fund_transfer',
            sourceId: transfer.id,
            amount,
            description: 'Cash received from branch',
            date,
            storeId: destination.storeId,
            counterpartyStoreId: source.storeId,
            // One transfer, two stores, two vouchers — the receiving leg needs its
            // own idempotency key or it collides with the sending one.
            legKey: 'receive',
        });

        await tx.fundTransfer.update({
            where: { id: transfer.id },
            data: { source_voucher_id: outgoing.voucherId ?? null, destination_voucher_id: incoming.voucherId ?? null },
        });
    }
}
