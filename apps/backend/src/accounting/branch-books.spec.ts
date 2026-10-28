import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
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
});
