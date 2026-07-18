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
        };

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

        const result = await service.list('tenant-1', { status: 'IN_TRANSIT' });

        expect(db.fundTransfer.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenant_id: 'tenant-1', status: 'IN_TRANSIT' },
            }),
        );
        expect(result).toHaveLength(1);
    });
});