import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerGroupsService } from './customer-groups.service';
import { DatabaseService } from '../database/database.service';
import { PriceListsService } from '../price-lists/price-lists.service';

describe('CustomerGroupsService', () => {
    let service: CustomerGroupsService;
    let db: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        db = {
            customerGroup: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
        };

        const priceListsService = {
            validatePriceListBelongsToTenant: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CustomerGroupsService,
                { provide: DatabaseService, useValue: db },
                { provide: PriceListsService, useValue: priceListsService },
            ],
        }).compile();

        service = module.get<CustomerGroupsService>(CustomerGroupsService);
    });

    // ─── create ────────────────────────────────────────────────────────────────

    describe('create', () => {
        const tenantId = 'tenant-1';
        const dto = { name: 'VIP Customers', discount_percent: 10 };

        it('should create a customer group when name is unique', async () => {
            db.customerGroup.findUnique.mockResolvedValue(null);
            const created = { id: 'cg-1', tenant_id: tenantId, ...dto };
            db.customerGroup.create.mockResolvedValue(created);

            const result = await service.create(tenantId, dto as any);

            expect(db.customerGroup.findUnique).toHaveBeenCalledWith({
                where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
            });
            expect(db.customerGroup.create).toHaveBeenCalledWith({
                data: { tenant_id: tenantId, ...dto },
                include: { priceList: { select: { id: true, name: true } } },
            });
            expect(result).toEqual(created);
        });

        it('should throw BadRequestException when name already exists', async () => {
            db.customerGroup.findUnique.mockResolvedValue({ id: 'existing' });

            const promise = service.create(tenantId, dto as any);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow(
                'A customer group with this name already exists.',
            );
            expect(db.customerGroup.create).not.toHaveBeenCalled();
        });
    });

    // ─── findAll ────────────────────────────────────────────────────────────────

    describe('findAll', () => {
        it('should return all customer groups with customer count', async () => {
            const tenantId = 'tenant-1';
            const groups = [
                { id: 'cg-1', name: 'Gold', _count: { customers: 5 } },
                { id: 'cg-2', name: 'Silver', _count: { customers: 3 } },
            ];
            db.customerGroup.findMany.mockResolvedValue(groups);
            db.customerGroup.count.mockResolvedValue(2);

            const result = await service.findAll(tenantId);

            expect(db.customerGroup.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: tenantId },
                    include: {
                        priceList: { select: { id: true, name: true } },
                        _count: { select: { customers: true } },
                    },
                    orderBy: { name: 'asc' },
                }),
            );
            expect(result.items).toEqual(groups);
            expect(result.total).toBe(2);
        });

        it('should return empty array when no groups exist', async () => {
            db.customerGroup.findMany.mockResolvedValue([]);
            db.customerGroup.count.mockResolvedValue(0);

            const result = await service.findAll('tenant-empty');

            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });
    });

    // ─── findOne ────────────────────────────────────────────────────────────────

    describe('findOne', () => {
        const tenantId = 'tenant-1';
        const groupId = 'cg-1';

        it('should return a customer group by id', async () => {
            const group = { id: groupId, name: 'VIP', _count: { customers: 2 } };
            db.customerGroup.findFirst.mockResolvedValue(group);

            const result = await service.findOne(tenantId, groupId);

            expect(db.customerGroup.findFirst).toHaveBeenCalledWith({
                where: { id: groupId, tenant_id: tenantId },
                include: {
                    priceList: { select: { id: true, name: true } },
                    _count: { select: { customers: true } },
                },
            });
            expect(result).toEqual(group);
        });

        it('should throw NotFoundException when group does not exist', async () => {
            db.customerGroup.findFirst.mockResolvedValue(null);

            const promise = service.findOne(tenantId, 'nonexistent');

            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Customer group not found');
        });
    });

    // ─── update ────────────────────────────────────────────────────────────────

    describe('update', () => {
        const tenantId = 'tenant-1';
        const groupId = 'cg-1';
        const existingGroup = { id: groupId, name: 'VIP', _count: { customers: 2 } };

        it('should update a group with new unique name', async () => {
            const dto = { name: 'VIP Premium' };
            db.customerGroup.findFirst
                .mockResolvedValueOnce(existingGroup)   // findOne check
                .mockResolvedValueOnce(null);           // duplicate name check
            const updated = { ...existingGroup, name: dto.name };
            db.customerGroup.update.mockResolvedValue(updated);

            const result = await service.update(tenantId, groupId, dto as any);

            expect(db.customerGroup.findFirst).toHaveBeenCalledTimes(2);
            expect(db.customerGroup.update).toHaveBeenCalledWith({
                where: { id: groupId },
                data: dto,
                include: { priceList: { select: { id: true, name: true } } },
            });
            expect(result).toEqual(updated);
        });

        it('should update without duplicate check when name not provided', async () => {
            const dto = { discount_percent: 15 };
            db.customerGroup.findFirst.mockResolvedValueOnce(existingGroup);
            db.customerGroup.update.mockResolvedValue({ ...existingGroup, ...dto });

            await service.update(tenantId, groupId, dto as any);

            // Only one call for findOne, no duplicate check
            expect(db.customerGroup.findFirst).toHaveBeenCalledTimes(1);
        });

        it('should throw NotFoundException when group not found', async () => {
            db.customerGroup.findFirst.mockResolvedValue(null);

            const promise = service.update(tenantId, 'nonexistent', { name: 'X' } as any);

            await expect(promise).rejects.toThrow(NotFoundException);
            expect(db.customerGroup.update).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException when new name conflicts', async () => {
            const dto = { name: 'Silver' };
            db.customerGroup.findFirst
                .mockResolvedValueOnce(existingGroup)
                .mockResolvedValueOnce({ id: 'other-cg' });

            const promise = service.update(tenantId, groupId, dto as any);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow(
                'A customer group with this name already exists.',
            );
            expect(db.customerGroup.update).not.toHaveBeenCalled();
        });
    });

    // ─── remove ────────────────────────────────────────────────────────────────

    describe('remove', () => {
        const tenantId = 'tenant-1';
        const groupId = 'cg-1';

        it('should delete a group with no customers', async () => {
            const group = { id: groupId, name: 'VIP', _count: { customers: 0 } };
            db.customerGroup.findFirst.mockResolvedValue(group);
            db.customerGroup.delete.mockResolvedValue(group);

            const result = await service.remove(tenantId, groupId);

            expect(db.customerGroup.delete).toHaveBeenCalledWith({ where: { id: groupId } });
            expect(result).toEqual(group);
        });

        it('should throw BadRequestException when group has customers', async () => {
            const group = { id: groupId, name: 'VIP', _count: { customers: 5 } };
            db.customerGroup.findFirst.mockResolvedValue(group);

            const promise = service.remove(tenantId, groupId);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow(
                'Cannot delete this group — it has associated customers. Reassign them first.',
            );
            expect(db.customerGroup.delete).not.toHaveBeenCalled();
        });

        it('should throw NotFoundException when group does not exist', async () => {
            db.customerGroup.findFirst.mockResolvedValue(null);

            const promise = service.remove(tenantId, 'nonexistent');

            await expect(promise).rejects.toThrow(NotFoundException);
            expect(db.customerGroup.delete).not.toHaveBeenCalled();
        });
    });
});
