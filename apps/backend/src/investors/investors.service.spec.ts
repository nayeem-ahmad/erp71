import { BadRequestException } from '@nestjs/common';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { InvestorsService } from './investors.service';

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
    voidAutoPostedVoucher: jest.fn(),
}));

const investorRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    tenant_id: 'tenant-1',
    store_id: null,
    name: 'Rahim',
    status: 'ACTIVE',
    profit_share_pct: 20,
    loss_carry_forward: 0,
    joined_on: new Date('2026-01-01'),
    exited_on: null,
    capitalTxns: [],
    profitShares: [],
    ...overrides,
});

describe('InvestorsService', () => {
    let service: InvestorsService;
    let db: any;
    let tx: any;
    let accounting: any;

    beforeEach(() => {
        jest.clearAllMocks();

        tx = {
            investor: { update: jest.fn().mockResolvedValue({}) },
            investorCapitalTxn: { create: jest.fn(), delete: jest.fn() },
            investorProfitRun: {
                create: jest.fn().mockResolvedValue({ id: 'run-1' }),
                update: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
            investorProfitShare: {
                create: jest.fn().mockImplementation(({ data }: any) => ({ id: `share-${data.investor_id}`, ...data })),
                update: jest.fn().mockResolvedValue({}),
            },
        };

        db = {
            $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
            investor: {
                findFirst: jest.fn().mockResolvedValue(investorRow()),
                findMany: jest.fn().mockResolvedValue([investorRow()]),
                create: jest.fn().mockResolvedValue(investorRow()),
                update: jest.fn().mockResolvedValue(investorRow()),
                delete: jest.fn().mockResolvedValue(investorRow()),
                count: jest.fn().mockResolvedValue(1),
            },
            investorCapitalTxn: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
            },
            investorProfitRun: {
                findUnique: jest.fn().mockResolvedValue(null),
                findFirst: jest.fn().mockResolvedValue({ id: 'run-1', shares: [] }),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
            },
            investorProfitShare: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
            },
            store: { findFirst: jest.fn().mockResolvedValue({ id: 'store-1' }) },
        };

        accounting = { getProfitLoss: jest.fn().mockResolvedValue({ net_profit: 100_000 }) };

        (autoPostFromRules as jest.Mock).mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'JV-00001',
        });

        service = new InvestorsService(db as any, accounting as any);
    });

    describe('capital', () => {
        it('posts investor_contribution when capital comes in', async () => {
            tx.investorCapitalTxn.create.mockResolvedValue({
                id: 'txn-1',
                txn_date: new Date('2026-07-01'),
                reference: null,
            });

            await service.addCapitalTxn('tenant-1', 'user-1', 'inv-1', {
                amount: 500_000,
                txnDate: '2026-07-01',
            });

            expect(autoPostFromRules).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: 'investor_contribution',
                    conditionKey: 'payment_mode',
                    conditionValue: 'cash',
                    amount: 500_000,
                    sourceModule: 'investors',
                }),
            );
        });

        it('routes a bank contribution to the bank rule', async () => {
            tx.investorCapitalTxn.create.mockResolvedValue({
                id: 'txn-1',
                txn_date: new Date('2026-07-01'),
                reference: null,
            });

            await service.addCapitalTxn('tenant-1', 'user-1', 'inv-1', {
                amount: 500_000,
                txnDate: '2026-07-01',
                paymentMethod: 'BANK',
            });

            expect(autoPostFromRules).toHaveBeenCalledWith(
                expect.objectContaining({ conditionValue: 'bank' }),
            );
        });

        it('refuses a withdrawal larger than the capital balance', async () => {
            db.investorCapitalTxn.findMany.mockResolvedValue([
                { direction: 'CONTRIBUTION', amount: 100_000 },
            ]);

            await expect(
                service.addCapitalTxn('tenant-1', 'user-1', 'inv-1', {
                    direction: 'WITHDRAWAL',
                    amount: 150_000,
                    txnDate: '2026-07-01',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(autoPostFromRules).not.toHaveBeenCalled();
        });
    });

    describe('share budget', () => {
        it('rejects an investor whose share pushes the active total past 100%', async () => {
            db.investor.findMany.mockResolvedValue([
                { profit_share_pct: 60 },
                { profit_share_pct: 30 },
            ]);

            await expect(
                service.create('tenant-1', 'user-1', {
                    name: 'Karim',
                    profitSharePct: 20,
                    joinedOn: '2026-01-01',
                }),
            ).rejects.toThrow(/SHARE_BUDGET_EXCEEDED/);
        });

        it('allows a share that exactly fills the remaining budget', async () => {
            db.investor.findMany.mockResolvedValue([{ profit_share_pct: 90 }]);

            await expect(
                service.create('tenant-1', 'user-1', {
                    name: 'Karim',
                    profitSharePct: 10,
                    joinedOn: '2026-01-01',
                }),
            ).resolves.toBeDefined();
        });
    });

    describe('profit runs', () => {
        it('posts one accrual per investor, tagged with the investor party', async () => {
            db.investor.findMany.mockResolvedValue([investorRow()]);

            await service.createProfitRun('tenant-1', 'user-1', { year: 2026, month: 7 });

            expect(autoPostFromRules).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: 'investor_profit_accrual',
                    conditionKey: 'none',
                    amount: 20_000,
                    partyType: 'INVESTOR',
                    partyId: 'inv-1',
                }),
            );
        });

        it('dates the accrual to the period end so a locked month is blocked', async () => {
            db.investor.findMany.mockResolvedValue([investorRow()]);

            await service.createProfitRun('tenant-1', 'user-1', { year: 2026, month: 7 });

            const call = (autoPostFromRules as jest.Mock).mock.calls[0][0];
            expect(call.date.toISOString().slice(0, 10)).toBe('2026-07-31');
        });

        it('refuses to run a month that has already been run', async () => {
            db.investorProfitRun.findUnique.mockResolvedValue({ id: 'run-existing' });

            await expect(
                service.createProfitRun('tenant-1', 'user-1', { year: 2026, month: 7 }),
            ).rejects.toThrow(/PROFIT_RUN_EXISTS/);
            expect(autoPostFromRules).not.toHaveBeenCalled();
        });

        it('keys the run on COMPANY when no store is given', async () => {
            db.investor.findMany.mockResolvedValue([investorRow()]);

            await service.createProfitRun('tenant-1', 'user-1', { year: 2026, month: 7 });

            expect(tx.investorProfitRun.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ scope_key: 'COMPANY', store_id: null }),
                }),
            );
        });

        it('reads branch profit when the run is scoped to a store', async () => {
            db.investor.findMany.mockResolvedValue([investorRow({ store_id: 'store-1' })]);

            await service.createProfitRun('tenant-1', 'user-1', { year: 2026, month: 7, storeId: 'store-1' });

            expect(accounting.getProfitLoss).toHaveBeenCalledWith(
                'tenant-1',
                expect.objectContaining({ scope: 'branch', storeId: 'store-1' }),
                true,
            );
        });

        it('posts nothing in a loss month but records the carry-forward', async () => {
            accounting.getProfitLoss.mockResolvedValue({ net_profit: -50_000 });
            db.investor.findMany.mockResolvedValue([investorRow()]);

            await service.createProfitRun('tenant-1', 'user-1', { year: 2026, month: 7 });

            expect(autoPostFromRules).not.toHaveBeenCalled();
            expect(tx.investor.update).toHaveBeenCalledWith({
                where: { id: 'inv-1' },
                data: { loss_carry_forward: 10_000 },
            });
        });

        it('snapshots the profit basis on the run', async () => {
            db.investor.findMany.mockResolvedValue([investorRow()]);

            await service.createProfitRun('tenant-1', 'user-1', { year: 2026, month: 7 });

            expect(tx.investorProfitRun.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ profit_basis_amount: 100_000 }),
                }),
            );
        });

        it('refuses a run with no eligible investors', async () => {
            db.investor.findMany.mockResolvedValue([]);

            await expect(
                service.createProfitRun('tenant-1', 'user-1', { year: 2026, month: 7 }),
            ).rejects.toThrow(/NO_ELIGIBLE_INVESTORS/);
        });

        it('previews without writing anything', async () => {
            db.investor.findMany.mockResolvedValue([investorRow()]);

            const preview = await service.previewProfitRun('tenant-1', { year: 2026, month: 7 });

            expect(preview.total_accrued).toBe(20_000);
            expect(db.$transaction).not.toHaveBeenCalled();
            expect(autoPostFromRules).not.toHaveBeenCalled();
        });
    });

    describe('deleting a run', () => {
        it('voids the accruals and reverses the carry-forward movement', async () => {
            db.investorProfitRun.findFirst.mockResolvedValue({
                id: 'run-1',
                shares: [{ id: 'share-1', investor_id: 'inv-1', status: 'ACCRUED', loss_applied: 10_000 }],
            });

            await service.deleteProfitRun('tenant-1', 'run-1');

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(
                tx,
                'tenant-1',
                'investor_profit_accrual',
                'share-1',
            );
            expect(tx.investor.update).toHaveBeenCalledWith({
                where: { id: 'inv-1' },
                data: { loss_carry_forward: { decrement: 10_000 } },
            });
        });

        it('refuses once a share has been paid', async () => {
            db.investorProfitRun.findFirst.mockResolvedValue({
                id: 'run-1',
                shares: [{ id: 'share-1', investor_id: 'inv-1', status: 'PAID', loss_applied: 0 }],
            });

            await expect(service.deleteProfitRun('tenant-1', 'run-1')).rejects.toThrow(
                /PROFIT_RUN_HAS_PAYOUTS/,
            );
        });
    });

    describe('payouts', () => {
        beforeEach(() => {
            db.investorProfitShare.findFirst.mockResolvedValue({
                id: 'share-1',
                investor_id: 'inv-1',
                amount: 20_000,
                status: 'ACCRUED',
                investor: { name: 'Rahim' },
                run: { year: 2026, month: 7, store_id: null },
            });
        });

        it('settles the share and posts the payout against the payable', async () => {
            await service.payShare('tenant-1', 'share-1', { paymentDate: '2026-08-05' });

            expect(tx.investorProfitShare.update).toHaveBeenCalledWith({
                where: { id: 'share-1' },
                data: { status: 'PAID', paid_amount: 20_000 },
            });
            expect(autoPostFromRules).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: 'investor_profit_payout',
                    amount: 20_000,
                    partyType: 'INVESTOR',
                    partyId: 'inv-1',
                }),
            );
        });

        it('refuses to pay the same share twice', async () => {
            db.investorProfitShare.findFirst.mockResolvedValue({
                id: 'share-1',
                investor_id: 'inv-1',
                amount: 20_000,
                status: 'PAID',
                investor: { name: 'Rahim' },
                run: { year: 2026, month: 7, store_id: null },
            });

            await expect(
                service.payShare('tenant-1', 'share-1', { paymentDate: '2026-08-05' }),
            ).rejects.toThrow(/PROFIT_SHARE_ALREADY_PAID/);
        });

        it('refuses to pay a zero share', async () => {
            db.investorProfitShare.findFirst.mockResolvedValue({
                id: 'share-1',
                investor_id: 'inv-1',
                amount: 0,
                status: 'ACCRUED',
                investor: { name: 'Rahim' },
                run: { year: 2026, month: 7, store_id: null },
            });

            await expect(
                service.payShare('tenant-1', 'share-1', { paymentDate: '2026-08-05' }),
            ).rejects.toThrow(/PROFIT_SHARE_ZERO/);
        });
    });

    describe('deleting an investor', () => {
        it('refuses once they have ledger history', async () => {
            db.investorCapitalTxn.count.mockResolvedValue(2);

            await expect(service.remove('tenant-1', 'inv-1')).rejects.toThrow(
                /INVESTOR_HAS_LEDGER_HISTORY/,
            );
        });

        it('allows deleting one who never transacted', async () => {
            db.investorCapitalTxn.count.mockResolvedValue(0);
            db.investorProfitShare.count.mockResolvedValue(0);

            await expect(service.remove('tenant-1', 'inv-1')).resolves.toBeDefined();
        });
    });
});
