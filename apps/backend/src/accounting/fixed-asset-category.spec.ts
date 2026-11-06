jest.mock('./posting.utils', () => ({
    assertFiscalPeriodOpen: jest.fn(),
    autoPostFromRules: jest.fn(),
}));

import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountingService } from './accounting.service';
import { CreateFixedAssetDto, FIXED_ASSET_CATEGORY_MAX_LENGTH, UpdateFixedAssetDto } from './accounting.dto';
import { autoPostFromRules } from './posting.utils';

/** A fixed asset's free-text category: what the asset register's Category chip filters on. */
describe('Fixed asset category', () => {
    const base = {
        assetCode: 'FA-001',
        name: 'Delivery Van',
        purchaseDate: '2026-06-01',
        cost: 120000,
        usefulLifeMonths: 60,
    };

    const parse = async <T extends object>(cls: new () => T, payload: unknown) => {
        const dto = plainToInstance(cls, payload);
        const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
        return { dto, errors };
    };

    describe('DTOs', () => {
        it('trims the category on create and update', async () => {
            const created = await parse(CreateFixedAssetDto, { ...base, category: '  Vehicles ' });
            expect(created.errors).toHaveLength(0);
            expect(created.dto.category).toBe('Vehicles');

            const updated = await parse(UpdateFixedAssetDto, { category: ' Furniture  ' });
            expect(updated.errors).toHaveLength(0);
            expect(updated.dto.category).toBe('Furniture');
        });

        it('reads a blank or null category as none, and leaves it optional', async () => {
            expect((await parse(CreateFixedAssetDto, { ...base, category: '   ' })).dto.category).toBeNull();
            expect((await parse(UpdateFixedAssetDto, { category: null })).errors).toHaveLength(0);
            const omitted = await parse(CreateFixedAssetDto, base);
            expect(omitted.errors).toHaveLength(0);
            expect(omitted.dto.category).toBeUndefined();
        });

        it('refuses a category that is too long or not text', async () => {
            const long = 'x'.repeat(FIXED_ASSET_CATEGORY_MAX_LENGTH + 1);
            expect((await parse(CreateFixedAssetDto, { ...base, category: long })).errors).not.toHaveLength(0);
            expect((await parse(UpdateFixedAssetDto, { category: 42 })).errors).not.toHaveLength(0);
        });

        it('takes nothing but the category on update', async () => {
            expect((await parse(UpdateFixedAssetDto, { category: 'IT', cost: 1 })).errors).not.toHaveLength(0);
        });
    });

    describe('AccountingService', () => {
        let db: any;
        let service: AccountingService;

        beforeEach(() => {
            jest.clearAllMocks();
            (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted' });
            db = {
                fixedAsset: {
                    findUnique: jest.fn().mockResolvedValue(null),
                    findFirst: jest.fn(),
                    findMany: jest.fn().mockResolvedValue([]),
                    create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'asset-1', ...data })),
                    update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'asset-1', ...data })),
                },
                $transaction: jest.fn(),
            };
            db.$transaction.mockImplementation(async (cb: any) => cb(db));
            service = new AccountingService(db, { log: jest.fn().mockResolvedValue(undefined) } as any, {} as any);
        });

        it('stores the category on create, null when none was given', async () => {
            await service.createFixedAsset('t1', { ...base, category: 'Vehicles' } as any);
            expect(db.fixedAsset.create.mock.calls[0][0].data.category).toBe('Vehicles');

            await service.createFixedAsset('t1', { ...base, assetCode: 'FA-002' } as any);
            expect(db.fixedAsset.create.mock.calls[1][0].data.category).toBeNull();
        });

        it('sets and clears the category of a tenant\'s own asset', async () => {
            db.fixedAsset.findFirst.mockResolvedValue({ id: 'asset-1' });

            await service.updateFixedAsset('t1', 'asset-1', { category: 'Furniture' });
            expect(db.fixedAsset.findFirst.mock.calls[0][0].where).toEqual({ id: 'asset-1', tenant_id: 't1' });
            expect(db.fixedAsset.update).toHaveBeenCalledWith({ where: { id: 'asset-1' }, data: { category: 'Furniture' } });

            await service.updateFixedAsset('t1', 'asset-1', { category: null });
            expect(db.fixedAsset.update).toHaveBeenLastCalledWith({ where: { id: 'asset-1' }, data: { category: null } });
        });

        it('refuses another tenant\'s asset', async () => {
            db.fixedAsset.findFirst.mockResolvedValue(null);
            await expect(service.updateFixedAsset('t1', 'foreign', { category: 'IT' }))
                .rejects.toBeInstanceOf(NotFoundException);
            expect(db.fixedAsset.update).not.toHaveBeenCalled();
        });

        it('changes nothing when the category is left out', async () => {
            db.fixedAsset.findFirst.mockResolvedValue({ id: 'asset-1' });
            await service.updateFixedAsset('t1', 'asset-1', {});
            expect(db.fixedAsset.update).not.toHaveBeenCalled();
        });
    });
});
