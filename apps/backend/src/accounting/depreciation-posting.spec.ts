jest.mock('./posting.utils', () => ({
    assertFiscalPeriodOpen: jest.fn(),
    autoPostFromRules: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { autoPostFromRules } from './posting.utils';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

describe('AccountingService.runDepreciation — posting', () => {
    let service: AccountingService;

    const asset = {
        id: 'asset-1',
        name: 'Delivery Van',
        asset_code: 'FA-001',
        cost: 120000,
        residual_value: 0,
        accumulated_depreciation: 0,
        useful_life_months: 60,
        depreciation_method: 'STRAIGHT_LINE',
    };

    const db = {
        fixedAsset: {
            findMany: jest.fn(),
            update: jest.fn().mockResolvedValue({}),
        },
        assetDepreciationEntry: {
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        db.$transaction.mockImplementation(async (cb: any) => cb(db));
        (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: { log: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => any) => fn() } },
            ],
        }).compile();
        service = module.get(AccountingService);
    });

    it('posts a depreciation voucher and writes the voucher back to the entry', async () => {
        db.fixedAsset.findMany.mockResolvedValue([asset]);
        db.assetDepreciationEntry.findUnique.mockResolvedValue(null);
        db.assetDepreciationEntry.create.mockResolvedValue({ id: 'entry-1' });

        const result = await service.runDepreciation('tenant-1', { year: 2026, month: 3 } as any);

        // 120000 / 60 = 2000/mo
        expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'depreciation',
            conditionKey: 'none',
            sourceModule: 'accounting',
            sourceType: 'depreciation',
            sourceId: 'entry-1',
            amount: 2000,
        }));
        // Dated to the last day of the depreciation month (Mar 2026 → Mar 31).
        const call = (autoPostFromRules as jest.Mock).mock.calls[0][0];
        expect((call.date as Date).toISOString().slice(0, 10)).toBe('2026-03-31');
        expect(db.assetDepreciationEntry.update).toHaveBeenCalledWith({
            where: { id: 'entry-1' },
            data: { voucher_id: 'v-1' },
        });
        expect(result.processed).toBe(1);
        expect(result.results[0].voucher_id).toBe('v-1');
    });

    it('runs the whole period inside one transaction', async () => {
        db.fixedAsset.findMany.mockResolvedValue([asset]);
        db.assetDepreciationEntry.findUnique.mockResolvedValue(null);
        db.assetDepreciationEntry.create.mockResolvedValue({ id: 'entry-1' });

        await service.runDepreciation('tenant-1', { year: 2026, month: 3 } as any);

        expect(db.$transaction).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: skips an asset already depreciated for the period', async () => {
        db.fixedAsset.findMany.mockResolvedValue([asset]);
        db.assetDepreciationEntry.findUnique.mockResolvedValue({ id: 'existing' });

        const result = await service.runDepreciation('tenant-1', { year: 2026, month: 3 } as any);

        expect(db.assetDepreciationEntry.create).not.toHaveBeenCalled();
        expect(autoPostFromRules).not.toHaveBeenCalled();
        expect(result.processed).toBe(0);
    });

    it('does not post for a fully-depreciated asset', async () => {
        db.fixedAsset.findMany.mockResolvedValue([
            { ...asset, accumulated_depreciation: 120000 },
        ]);
        db.assetDepreciationEntry.findUnique.mockResolvedValue(null);

        const result = await service.runDepreciation('tenant-1', { year: 2026, month: 3 } as any);

        expect(autoPostFromRules).not.toHaveBeenCalled();
        expect(result.processed).toBe(0);
    });

    it('propagates a posting failure so the transaction rolls back', async () => {
        // A locked period makes autoPostFromRules throw. The throw must escape
        // runDepreciation so the surrounding $transaction rolls back the entry and
        // the accumulated-depreciation increment with it.
        db.fixedAsset.findMany.mockResolvedValue([asset]);
        db.assetDepreciationEntry.findUnique.mockResolvedValue(null);
        db.assetDepreciationEntry.create.mockResolvedValue({ id: 'entry-1' });
        (autoPostFromRules as jest.Mock).mockRejectedValue(new Error('FISCAL_PERIOD_LOCKED'));

        await expect(service.runDepreciation('tenant-1', { year: 2026, month: 3 } as any))
            .rejects.toThrow('FISCAL_PERIOD_LOCKED');
    });
});
