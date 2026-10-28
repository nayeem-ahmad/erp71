import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ensureInterBranchAccounts } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { autoPostFromRules } from '../accounting/posting.utils';
import { FundTransfersService } from './fund-transfers.service';

jest.mock('@erp71/database', () => ({
    ...jest.requireActual('@erp71/database'),
    ensureInterBranchAccounts: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' }),
}));

describe('FundTransfersService', () => {
    let service: FundTransfersService;
    let tx: any;

    const db = {
        store: { findFirst: jest.fn() },
        fundTransfer: {
            create: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
        account: { findFirst: jest.fn() },
        voucher: { create: jest.fn() },
        voucherSequence: { upsert: jest.fn(), update: jest.fn() },
        $transaction: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        tx = {
            fundTransfer: {
                create: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
            account: { findFirst: jest.fn() },
            voucher: { create: jest.fn() },
            voucherSequence: {
                upsert: jest.fn().mockResolvedValue({ next_number: 1, prefix: 'FT' }),
                update: jest.fn().mockResolvedValue({}),
            },
            // null = no covering fiscal period, which correctly allows posting.
            fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
            paymentMethod: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            voucherDetail: { findMany: jest.fn().mockResolvedValue([]) },
        };
        tx.account.findMany = jest.fn().mockImplementation(async ({ where }: { where?: { store_id?: string } }) => [{
            id: 'cash-1',
            name: 'Cash in Hand',
            category: 'cash',
            store_id: where?.store_id ?? 'store-a',
        }]);

        db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
        db.store.findFirst.mockResolvedValue({ id: 'store-1' });
        tx.account.findFirst
            .mockResolvedValueOnce({ id: 'cash-1' })
            .mockResolvedValueOnce({ id: 'due-from-1' })
            .mockResolvedValueOnce({ id: 'due-to-1' });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FundTransfersService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get(FundTransfersService);
    });

    it('initiate posts the source leg through the rules engine and marks in-transit', async () => {
        (autoPostFromRules as jest.Mock).mockClear();
        (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-source-1' });
        tx.fundTransfer.create.mockResolvedValue({ id: 'ft-1' });
        tx.fundTransfer.update.mockResolvedValue({
            id: 'ft-1',
            status: 'IN_TRANSIT',
            source_voucher_id: 'v-source-1',
        });

        const result = await service.initiate('tenant-1', 'user-1', {
            sourceStoreId: 'store-a',
            destinationStoreId: 'store-b',
            amount: 500,
        });

        expect(ensureInterBranchAccounts).toHaveBeenCalledWith(tx, 'tenant-1');
        expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'fund_transfer',
            conditionKey: 'transfer_scope',
            conditionValue: 'initiate',
            legKey: 'initiate',
            sourceId: 'ft-1',
            amount: 500,
            storeId: 'store-a',
            counterpartyStoreId: 'store-b',
        }));
        expect(result.status).toBe('IN_TRANSIT');
    });

    it('rejects initiate when source and destination are the same', async () => {
        await expect(
            service.initiate('tenant-1', 'user-1', {
                sourceStoreId: 'store-a',
                destinationStoreId: 'store-a',
                amount: 100,
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('receive posts the destination leg through the rules engine and marks received', async () => {
        (autoPostFromRules as jest.Mock).mockClear();
        (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-dest-1' });
        tx.fundTransfer.findFirst.mockResolvedValue({
            id: 'ft-1',
            status: 'IN_TRANSIT',
            source_voucher_id: 'v-source-1',
            source_store_id: 'store-a',
            destination_store_id: 'store-b',
            amount: 500,
            description: null,
        });
        tx.fundTransfer.update.mockResolvedValue({
            id: 'ft-1',
            status: 'RECEIVED',
            destination_voucher_id: 'v-dest-1',
        });

        const result = await service.receive('tenant-1', 'user-2', 'ft-1');

        expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'fund_transfer',
            conditionValue: 'receive',
            legKey: 'receive',
            sourceId: 'ft-1',
            amount: 500,
            storeId: 'store-b',
            counterpartyStoreId: 'store-a',
        }));
        expect(result.status).toBe('RECEIVED');
    });

    it('throws when receiving unknown transfer', async () => {
        tx.fundTransfer.findFirst.mockResolvedValue(null);

        await expect(service.receive('tenant-1', 'user-2', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('lists transfers for tenant', async () => {
        db.fundTransfer.findMany.mockResolvedValue([{ id: 'ft-1' }]);

        const result = await service.list('tenant-1', { timezone: 'Asia/Dhaka', status: 'IN_TRANSIT' });

        expect(db.fundTransfer.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenant_id: 'tenant-1', status: 'IN_TRANSIT' },
            }),
        );
        expect(result).toHaveLength(1);
    });

    const babu = '5998f11f-70ff-4eec-a1c8-c42418cd461b';
    const press = '501fed1b-9732-44fa-98b1-271fae2bc135';
    const cf = 'f5a45408-79b0-4b70-b3af-bc2fe806085d';
    const lt = '9df1d62c-b797-4111-9ffc-17a22862c4f0';
    const premier = '110102';

    it('credits the source drawer on a cash initiate and debits the destination drawer on receive', async () => {
        (autoPostFromRules as jest.Mock).mockClear();
        (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' });
        tx.account.findMany.mockImplementation(async ({ where }: { where?: { store_id?: string } }) => {
            if (where?.store_id === babu) return [{ id: cf, name: 'Main Cash (CF)', category: 'cash', store_id: babu }];
            if (where?.store_id === press) return [{ id: lt, name: 'Main Cash (LT)', category: 'cash', store_id: press }];
            return [];
        });
        tx.fundTransfer.create.mockResolvedValue({ id: 'ft-1' });
        tx.fundTransfer.update.mockResolvedValue({ id: 'ft-1', status: 'IN_TRANSIT' });

        await service.initiate('tenant-1', 'user-1', {
            sourceStoreId: babu,
            destinationStoreId: press,
            amount: 500,
            method: 'CASH',
        });

        expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({ overrideCreditAccountId: cf }));

        tx.fundTransfer.findFirst.mockResolvedValue({
            id: 'ft-1',
            status: 'IN_TRANSIT',
            method: 'CASH',
            source_voucher_id: 'v-1',
            source_store_id: babu,
            destination_store_id: press,
            amount: 500,
            description: null,
        });
        await service.receive('tenant-1', 'user-2', 'ft-1');

        expect(autoPostFromRules).toHaveBeenLastCalledWith(expect.objectContaining({ overrideDebitAccountId: lt }));
    });

    it('posts a bank transfer to Premier Bank on both legs', async () => {
        (autoPostFromRules as jest.Mock).mockClear();
        (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' });
        tx.paymentMethod.findFirst.mockResolvedValue({
            account_id: premier,
            account: { id: premier, name: 'Premier Bank 186', category: 'bank', store_id: null },
        });
        tx.fundTransfer.create.mockResolvedValue({ id: 'ft-1' });
        tx.fundTransfer.update.mockResolvedValue({ id: 'ft-1', status: 'IN_TRANSIT' });

        await service.initiate('tenant-1', 'user-1', {
            sourceStoreId: babu,
            destinationStoreId: press,
            amount: 800,
            method: 'BANK_TRANSFER',
        });

        const initiate = (autoPostFromRules as jest.Mock).mock.calls.at(-1)[0];
        expect(initiate.overrideCreditAccountId).toBe(premier);
        expect(initiate.overrideCreditAccountId).not.toBe(cf);
        expect(initiate.overrideCreditAccountId).not.toBe(lt);

        tx.voucherDetail.findMany.mockResolvedValue([
            { debit_amount: 800, credit_amount: 0, account: { id: 'due', name: 'Due from Branches', code: '110401', category: 'asset' } },
            { debit_amount: 0, credit_amount: 800, account: { id: premier, name: 'Premier Bank 186', code: '110102', category: 'bank', store_id: null } },
        ]);
        tx.fundTransfer.findFirst.mockResolvedValue({
            id: 'ft-1',
            status: 'IN_TRANSIT',
            method: 'BANK_TRANSFER',
            source_voucher_id: 'v-1',
            source_store_id: babu,
            destination_store_id: press,
            amount: 800,
            description: null,
        });
        await service.receive('tenant-1', 'user-2', 'ft-1');

        const receive = (autoPostFromRules as jest.Mock).mock.calls.at(-1)[0];
        expect(receive.overrideDebitAccountId).toBe(premier);
        expect(receive.overrideDebitAccountId).not.toBe(cf);
        expect(receive.overrideDebitAccountId).not.toBe(lt);
    });

    it('hides a transfer the caller is not a side of', async () => {
        const other = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        db.fundTransfer.findFirst.mockImplementation(async ({ where }: { where: { OR?: Array<{ source_store_id?: { in?: string[] } }> } }) => {
            const allowed = where.OR?.[0]?.source_store_id?.in;
            if (allowed && !allowed.includes(babu) && !allowed.includes(press)) return null;
            return { id: 'ft-1', source_store_id: babu, destination_store_id: press };
        });

        await expect(service.get('tenant-1', 'ft-1', [other])).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists the transfers out of or into one branch', async () => {
        db.fundTransfer.findMany.mockResolvedValue([]);

        await service.list('tenant-1', { timezone: 'Asia/Dhaka', storeId: 'store-1' });

        expect(db.fundTransfer.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    tenant_id: 'tenant-1',
                    OR: [{ source_store_id: 'store-1' }, { destination_store_id: 'store-1' }],
                },
            }),
        );
    });
});
