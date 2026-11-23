import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductFamiliesService } from './product-families.service';

describe('ProductFamiliesService', () => {
    const tenantId = 'tenant-1';
    let db: any;
    let redis: any;
    let service: ProductFamiliesService;

    const familyRecord = {
        id: 'fam-1',
        name: 'Belt OAC',
        description: null,
        image_url: 's.jpg',
        images_gallery: [],
        option_names: ['Size'],
        is_featured: false,
        created_at: new Date(),
        updated_at: new Date(),
        products: [],
    };

    beforeEach(() => {
        db = {
            product: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            productFamily: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
                create: jest.fn().mockResolvedValue({ id: 'fam-1' }),
                update: jest.fn(),
                delete: jest.fn(),
            },
        };
        db.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(db));
        redis = { invalidatePattern: jest.fn() };
        service = new ProductFamiliesService(db, redis);
    });

    describe('create', () => {
        const dto = {
            name: ' Belt OAC ',
            optionNames: ['Size'],
            members: [
                { productId: 'p-s', optionValues: { Size: 'S' } },
                { productId: 'p-m', optionValues: { Size: 'M' } },
            ],
        };

        it('creates the family, claims each member and clears the products cache', async () => {
            db.product.findMany.mockResolvedValue([
                { id: 'p-s', name: 'Belt OAC S', image_url: 's.jpg', family_id: null, family: null },
                { id: 'p-m', name: 'Belt OAC M', image_url: null, family_id: null, family: null },
            ]);
            db.productFamily.findFirst.mockResolvedValue(familyRecord);

            await service.create(tenantId, dto);

            expect(db.productFamily.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    tenant_id: tenantId,
                    name: 'Belt OAC',
                    image_url: 's.jpg',
                    option_names: ['Size'],
                }),
            });
            expect(db.product.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 'p-s',
                    tenant_id: tenantId,
                    deleted_at: null,
                    OR: [{ family_id: null }, { family_id: 'fam-1' }],
                },
                data: { family_id: 'fam-1', option_values: { Size: 'S' } },
            });
            expect(redis.invalidatePattern).toHaveBeenCalledWith(`products:${tenantId}:`);
        });

        it('refuses a product that is already a variant of another family', async () => {
            db.product.findMany.mockResolvedValue([
                { id: 'p-s', name: 'Belt OAC S', image_url: null, family_id: 'fam-9', family: { name: 'Other belt' } },
                { id: 'p-m', name: 'Belt OAC M', image_url: null, family_id: null, family: null },
            ]);

            await expect(service.create(tenantId, dto)).rejects.toThrow(/Belt OAC S.*Other belt/);
            expect(db.productFamily.create).not.toHaveBeenCalled();
        });

        it("refuses a product that is not this tenant's", async () => {
            db.product.findMany.mockResolvedValue([
                { id: 'p-s', name: 'Belt OAC S', image_url: null, family_id: null, family: null },
            ]);

            await expect(service.create(tenantId, dto)).rejects.toThrow(BadRequestException);
        });

        it('refuses two members with the same combination before touching the database', async () => {
            await expect(
                service.create(tenantId, {
                    ...dto,
                    members: [
                        { productId: 'p-s', optionValues: { Size: 'M' } },
                        { productId: 'p-m', optionValues: { Size: 'm' } },
                    ],
                }),
            ).rejects.toThrow(BadRequestException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('rolls back when a member was claimed by someone else meanwhile', async () => {
            db.product.findMany.mockResolvedValue([
                { id: 'p-s', name: 'Belt OAC S', image_url: null, family_id: null, family: null },
                { id: 'p-m', name: 'Belt OAC M', image_url: null, family_id: null, family: null },
            ]);
            db.product.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

            await expect(service.create(tenantId, dto)).rejects.toThrow(/changed while grouping/);
        });
    });

    describe('update', () => {
        it('releases members left out of the new list', async () => {
            db.productFamily.findFirst.mockResolvedValue(familyRecord);
            db.product.findMany.mockResolvedValue([
                { id: 'p-s', name: 'Belt OAC S', image_url: null, family_id: 'fam-1', family: { name: 'Belt OAC' } },
            ]);

            await service.update(tenantId, 'fam-1', { members: [{ productId: 'p-s', optionValues: { Size: 'S' } }] });

            expect(db.product.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: tenantId, family_id: 'fam-1', id: { notIn: ['p-s'] } },
                data: { family_id: null, option_values: Prisma.DbNull },
            });
        });

        it('refuses new option names without the values that go with them', async () => {
            db.productFamily.findFirst.mockResolvedValue(familyRecord);

            await expect(service.update(tenantId, 'fam-1', { optionNames: ['Size', 'Color'] })).rejects.toThrow(
                BadRequestException,
            );
        });

        it("404s another tenant's family", async () => {
            db.productFamily.findFirst.mockResolvedValue(null);
            await expect(service.update(tenantId, 'fam-x', { name: 'x' })).rejects.toThrow(NotFoundException);
        });
    });

    describe('remove', () => {
        it('ungroups every member, then deletes the family', async () => {
            db.productFamily.findFirst.mockResolvedValue({ id: 'fam-1' });

            await service.remove(tenantId, 'fam-1');

            expect(db.product.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: tenantId, family_id: 'fam-1' },
                data: { family_id: null, option_values: Prisma.DbNull },
            });
            expect(db.productFamily.delete).toHaveBeenCalledWith({ where: { id: 'fam-1' } });
        });
    });

    describe('suggestions', () => {
        it('suggests ungrouped goods whose names differ by a trailing size', async () => {
            db.product.findMany.mockResolvedValue([
                { id: 'p-l', name: 'Belt OAC L', sku: 'P00972', price: 600 },
                { id: 'p-s', name: 'Belt OAC S', sku: 'P00970', price: 500 },
                { id: 'x', name: 'Napa 500', sku: null, price: 10 },
            ]);

            const result = await service.suggestions(tenantId);

            expect(db.product.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: tenantId, deleted_at: null, family_id: null, type: 'GOODS' },
                }),
            );
            expect(result).toEqual([
                {
                    name: 'Belt OAC',
                    optionName: 'Size',
                    members: [
                        { productId: 'p-s', name: 'Belt OAC S', sku: 'P00970', price: 500, value: 'S' },
                        { productId: 'p-l', name: 'Belt OAC L', sku: 'P00972', price: 600, value: 'L' },
                    ],
                },
            ]);
        });
    });
});
