import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CrmLeadTaxonomyService } from './crm-lead-taxonomy.service';
import { DatabaseService } from '../database/database.service';
import { LeadTaxonomyKind } from './lead-taxonomy.dto';

describe('CrmLeadTaxonomyService', () => {
    let service: CrmLeadTaxonomyService;
    let db: any;

    const walkIn = {
        id: 'src-walk',
        tenant_id: 'tenant-1',
        code: 'WALK_IN',
        name: 'Walk-in',
        score_weight: 15,
        is_system: true,
        is_active: true,
    };
    const custom = {
        id: 'src-fair',
        tenant_id: 'tenant-1',
        code: 'TRADE_FAIR',
        name: 'Trade Fair',
        score_weight: 10,
        is_system: false,
        is_active: true,
    };
    const other = { ...walkIn, id: 'src-other', code: 'OTHER', name: 'Other', score_weight: 5 };

    beforeEach(async () => {
        db = {
            leadSourceOption: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                aggregate: jest.fn().mockResolvedValue({ _max: { sort_order: 3 } }),
            },
            leadCategoryOption: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                aggregate: jest.fn().mockResolvedValue({ _max: { sort_order: 3 } }),
            },
            lead: {
                count: jest.fn().mockResolvedValue(0),
                updateMany: jest.fn(),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [CrmLeadTaxonomyService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(CrmLeadTaxonomyService);
    });

    describe('create()', () => {
        it('derives an immutable code from the name', async () => {
            await service.create('tenant-1', LeadTaxonomyKind.SOURCE, { name: 'Trade Fair 2026' });

            expect(db.leadSourceOption.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ code: 'TRADE_FAIR_2026', name: 'Trade Fair 2026' }),
                }),
            );
        });

        it('suffixes the code when the derived one is taken', async () => {
            db.leadSourceOption.findMany.mockResolvedValue([{ id: 'x', name: 'Something', code: 'TRADE_FAIR' }]);

            await service.create('tenant-1', LeadTaxonomyKind.SOURCE, { name: 'Trade Fair' });

            expect(db.leadSourceOption.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ code: 'TRADE_FAIR_2' }) }),
            );
        });

        it('rejects a name that collides case-insensitively', async () => {
            db.leadSourceOption.findMany.mockResolvedValue([{ id: 'x', name: 'Meta Ads', code: 'META_ADS' }]);

            await expect(
                service.create('tenant-1', LeadTaxonomyKind.SOURCE, { name: '  meta   ads ' }),
            ).rejects.toThrow(ConflictException);
        });

        it('omits score_weight for categories, which have no such column', async () => {
            await service.create('tenant-1', LeadTaxonomyKind.CATEGORY, { name: 'Reseller' });

            const data = db.leadCategoryOption.create.mock.calls[0][0].data;
            expect(data).not.toHaveProperty('score_weight');
        });
    });

    describe('remove()', () => {
        it('refuses to delete a row still in use without a replacement', async () => {
            db.leadSourceOption.findFirst.mockResolvedValue(custom);
            db.lead.count.mockResolvedValue(42);

            await expect(
                service.remove('tenant-1', LeadTaxonomyKind.SOURCE, custom.id),
            ).rejects.toThrow(ConflictException);
            expect(db.leadSourceOption.delete).not.toHaveBeenCalled();
        });

        it('reassigns leads before deleting when a replacement is given', async () => {
            db.leadSourceOption.findFirst.mockResolvedValueOnce(custom).mockResolvedValueOnce(walkIn);
            db.lead.count.mockResolvedValue(42);

            const result = await service.remove(
                'tenant-1',
                LeadTaxonomyKind.SOURCE,
                custom.id,
                walkIn.id,
            );

            expect(db.lead.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', source_id: custom.id },
                data: { source_id: walkIn.id },
            });
            expect(db.leadSourceOption.delete).toHaveBeenCalledWith({ where: { id: custom.id } });
            expect(result).toEqual({ success: true, reassigned: 42 });
        });

        it('deactivates a seeded row instead of deleting it', async () => {
            // A hard delete would be undone by sync-lead-taxonomy on the next
            // container start, so system rows deactivate.
            db.leadSourceOption.findFirst.mockResolvedValue(walkIn);

            await service.remove('tenant-1', LeadTaxonomyKind.SOURCE, walkIn.id);

            expect(db.leadSourceOption.delete).not.toHaveBeenCalled();
            expect(db.leadSourceOption.update).toHaveBeenCalledWith({
                where: { id: walkIn.id },
                data: { is_active: false },
            });
        });

        it('protects the fallback source, which lead creation depends on', async () => {
            db.leadSourceOption.findFirst.mockResolvedValue(other);

            await expect(
                service.remove('tenant-1', LeadTaxonomyKind.SOURCE, other.id),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects an unknown id', async () => {
            db.leadSourceOption.findFirst.mockResolvedValue(null);

            await expect(
                service.remove('tenant-1', LeadTaxonomyKind.SOURCE, 'nope'),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('update()', () => {
        it('refuses to deactivate the fallback source', async () => {
            db.leadSourceOption.findFirst.mockResolvedValue(other);

            await expect(
                service.update('tenant-1', LeadTaxonomyKind.SOURCE, other.id, { is_active: false }),
            ).rejects.toThrow(BadRequestException);
        });

        it('renames without touching the code', async () => {
            db.leadSourceOption.findFirst.mockResolvedValue(walkIn);
            db.leadSourceOption.findMany.mockResolvedValue([]);

            await service.update('tenant-1', LeadTaxonomyKind.SOURCE, walkIn.id, { name: 'Shop Visit' });

            const data = db.leadSourceOption.update.mock.calls[0][0].data;
            expect(data).toEqual({ name: 'Shop Visit' });
            expect(data).not.toHaveProperty('code');
        });
    });

    describe('resolveByIdOrCode()', () => {
        it('matches on id first', async () => {
            db.leadSourceOption.findFirst.mockResolvedValue(walkIn);

            await expect(
                service.resolveByIdOrCode('tenant-1', LeadTaxonomyKind.SOURCE, 'src-walk'),
            ).resolves.toEqual(walkIn);
        });

        it('falls back to code, then to a case-insensitive name', async () => {
            db.leadSourceOption.findFirst.mockResolvedValue(null);
            db.leadSourceOption.findMany.mockResolvedValue([walkIn, custom]);

            await expect(
                service.resolveByIdOrCode('tenant-1', LeadTaxonomyKind.SOURCE, 'walk_in'),
            ).resolves.toEqual(walkIn);
            await expect(
                service.resolveByIdOrCode('tenant-1', LeadTaxonomyKind.SOURCE, 'trade fair'),
            ).resolves.toEqual(custom);
        });

        it('returns null for an unknown value rather than guessing', async () => {
            db.leadSourceOption.findFirst.mockResolvedValue(null);
            db.leadSourceOption.findMany.mockResolvedValue([walkIn]);

            await expect(
                service.resolveByIdOrCode('tenant-1', LeadTaxonomyKind.SOURCE, 'nope'),
            ).resolves.toBeNull();
        });
    });

    describe('usage()', () => {
        it('maps lead counts by row id', async () => {
            db.lead.groupBy.mockResolvedValue([
                { source_id: 'src-walk', _count: { _all: 7 } },
                { source_id: null, _count: { _all: 3 } },
            ]);

            await expect(service.usage('tenant-1', LeadTaxonomyKind.SOURCE)).resolves.toEqual({
                'src-walk': 7,
            });
        });
    });
});
