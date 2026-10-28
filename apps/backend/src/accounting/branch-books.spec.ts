import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { AccountType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

/**
 * Branch cash drawers and filtered shared books. Labels are the KH Trading
 * account names; nothing here talks to a database.
 */
describe('AccountingService — branch books', () => {
    const babu = '5998f11f-70ff-4eec-a1c8-c42418cd461b';
    const press = '501fed1b-9732-44fa-98b1-271fae2bc135';

    let service: AccountingService;

    const db = {
        account: { findMany: jest.fn(), findFirst: jest.fn() },
        voucherDetail: { groupBy: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
        accountingSettings: { findUnique: jest.fn() },
        paymentMethod: { findMany: jest.fn() },
    };

    beforeEach(async () => {
        jest.resetAllMocks();
        db.accountingSettings.findUnique.mockResolvedValue(null);
        db.paymentMethod.findMany.mockResolvedValue([]);
        db.voucherDetail.groupBy.mockResolvedValue([]);
        db.voucherDetail.aggregate.mockResolvedValue({ _sum: { debit_amount: 0, credit_amount: 0 } });
        db.voucherDetail.findMany.mockResolvedValue([]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: { log: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => unknown) => fn() } },
            ],
        }).compile();
        service = module.get(AccountingService);
    });

    const bank = {
        id: 'premier',
        name: 'Premier Bank 186',
        code: '110102',
        type: 'asset',
        category: 'bank',
        store_id: null,
        group: { id: 'g' },
        subgroup: null,
    };

    it('limits the chart to the branch drawer and that branch’s vouchers', async () => {
        db.account.findMany.mockResolvedValue([bank]);

        await service.findAccounts('tenant-1', {}, babu);

        expect(db.account.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenant_id: 'tenant-1',
                OR: [{ store_id: null }, { store_id: babu }],
            }),
        }));
        expect(db.voucherDetail.groupBy).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                voucher: expect.objectContaining({ store_id: babu }),
            }),
        }));
    });

    it('keeps every drawer and every voucher, including ones with no branch, for the company view', async () => {
        db.account.findMany.mockResolvedValue([bank]);

        await service.findAccounts('tenant-1', {}, undefined);

        const where = db.account.findMany.mock.calls[0][0].where;
        expect(where.OR).toBeUndefined();
        expect(where.store_id).toBeUndefined();
        const voucher = db.voucherDetail.groupBy.mock.calls[0][0].where.voucher;
        expect(voucher.store_id).toBeUndefined();
    });

    it('hides another branch’s drawer from the ledger', async () => {
        db.account.findFirst.mockResolvedValue({
            id: 'lt',
            name: 'Main Cash (LT)',
            store_id: press,
            type: 'asset',
            category: 'cash',
            group: { id: 'g' },
            subgroup: null,
        });

        await expect(service.findLedger('tenant-1', 'lt', {}, babu)).rejects.toBeInstanceOf(NotFoundException);
        expect(db.voucherDetail.findMany).not.toHaveBeenCalled();
    });

    it('filters a shared bank ledger to the branch', async () => {
        db.account.findFirst.mockResolvedValue(bank);

        await service.findLedger('tenant-1', 'premier', {}, babu);

        expect(db.voucherDetail.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                voucher: expect.objectContaining({ store_id: babu }),
            }),
        }));
    });

    it('builds the cash book from that branch’s drawer only', async () => {
        db.account.findMany.mockResolvedValue([]);

        await service.getCashbook('tenant-1', { from: '2026-10-01', to: '2026-10-31' }, babu);

        expect(db.account.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ category: 'cash', store_id: babu }),
        }));
    });

    it('builds the bank book from banks and shared wallets, limited to the branch’s lines', async () => {
        db.account.findMany.mockResolvedValue([bank]);

        await service.getBankbook('tenant-1', { from: '2026-10-01', to: '2026-10-31' }, babu);

        expect(db.account.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: [{ category: 'bank' }, { category: 'cash', store_id: null }],
            }),
        }));
        expect(db.voucherDetail.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                voucher: expect.objectContaining({ store_id: babu }),
            }),
        }));
    });

    it('omits the other branch’s drawer and keeps the shared bank at this branch’s figure', async () => {
        const group = { id: 'g', name: 'Current Assets', code: '11' };
        const accounts = [
            { id: 'cf', name: 'Main Cash (CF)', code: '110101', type: AccountType.ASSET, category: 'cash', store_id: babu, group, subgroup: { id: 'sgc', name: 'Cash', code: '1101' } },
            { id: 'lt', name: 'Main Cash (LT)', code: '110112', type: AccountType.ASSET, category: 'cash', store_id: press, group, subgroup: { id: 'sgc', name: 'Cash', code: '1101' } },
            { id: 'bank', name: 'Premier Bank 186', code: '110102', type: AccountType.ASSET, category: 'bank', store_id: null, group, subgroup: { id: 'sgb', name: 'Bank', code: '1102' } },
        ];
        const lines = [
            { account_id: 'cf', debit_amount: 100, credit_amount: 0, voucher: { store_id: babu } },
            { account_id: 'lt', debit_amount: 50, credit_amount: 0, voucher: { store_id: press } },
            { account_id: 'bank', debit_amount: 10, credit_amount: 0, voucher: { store_id: babu } },
            { account_id: 'bank', debit_amount: 25, credit_amount: 0, voucher: { store_id: press } },
        ];
        db.account.findMany.mockImplementation(async ({ where }: { where?: { type?: { in?: string[] }; OR?: Array<{ store_id: string | null }> } }) => {
            const types = where?.type?.in;
            let rows = types ? accounts.filter((account) => types.includes(account.type)) : accounts;
            if (where?.OR) {
                rows = rows.filter((account) => where.OR!.some((clause) => clause.store_id === account.store_id));
            }
            return rows;
        });
        db.voucherDetail.findMany.mockImplementation(async ({ where }: { where?: { voucher?: { store_id?: string } } }) => {
            const storeId = where?.voucher?.store_id;
            return storeId ? lines.filter((line) => line.voucher.store_id === storeId) : lines;
        });

        const result = await service.getBalanceSheet('tenant-1', { scope: 'branch', storeId: babu, level: 'account' }, true);
        if (!('assets' in result)) {
            throw new Error('expected a single-branch balance sheet');
        }
        const rows = result.assets.groups.flatMap((entry) => entry.rows);

        expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['Main Cash (CF)', 'Premier Bank 186']));
        expect(rows.map((row) => row.name)).not.toContain('Main Cash (LT)');
        expect(rows.find((row) => row.name === 'Premier Bank 186')?.balance).toBe(10);
    });

    it('leaves the other branch’s open invoice out of aging', async () => {
        db.account.findMany.mockResolvedValue([
            { id: 'ar', name: 'Accounts Receivable', code: '120101', type: AccountType.ASSET },
        ]);
        const lines = [
            { account_id: 'ar', debit_amount: 100, credit_amount: 0, voucher: { date: new Date('2026-10-20T00:00:00.000Z'), store_id: babu } },
            { account_id: 'ar', debit_amount: 40, credit_amount: 0, voucher: { date: new Date('2026-10-18T00:00:00.000Z'), store_id: press } },
        ];
        db.voucherDetail.findMany.mockImplementation(async ({ where }: { where?: { voucher?: { store_id?: string } } }) => {
            const storeId = where?.voucher?.store_id;
            return storeId ? lines.filter((line) => line.voucher.store_id === storeId) : lines;
        });

        const result = await service.getArAging('tenant-1', { asOfDate: '2026-10-28' }, babu);

        expect(result.totals.balance).toBe(100);
    });
});
