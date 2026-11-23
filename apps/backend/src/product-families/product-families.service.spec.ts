import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductFamiliesService } from './product-families.service';

describe('ProductFamiliesService', () => {
    const tenantId = 'tenant-1';
    let db: any;
    let redis: any;
    let products: any;
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
        // Runs the caller's grouping step with made-up ids, as the real
        // createMany does inside its transaction.
        products = {
            createMany: jest.fn(async (_t: string, dtos: unknown[], _u: unknown, then: (tx: unknown, ids: string[]) => unknown) => {
                const productIds = dtos.map((_, i) => `new-${i}`);
                return { productIds, result: await then(db, productIds) };
            }),
        };
        service = new ProductFamiliesService(db, redis, products);
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

    describe('generate', () => {
        const base = {
            id: 'base',
            name: 'Belt OAC',
            type: 'GOODS',
            sku: 'P1',
            image_url: 'b.jpg',
            brand_id: null,
            group_id: 'g1',
            subgroup_id: null,
            reorder_level: null,
            safety_stock: null,
            lead_time_days: null,
            warranty_enabled: false,
            warranty_duration_days: null,
            unit_type: 'pcs',
            vat_rate: null,
            sd_rate: null,
            cost: { avg_cost: 300 },
            family: null,
        };

        beforeEach(() => {
            db.product.findFirst = jest.fn();
            db.productFamily.findFirst.mockResolvedValue(familyRecord);
        });

        it('makes one product per combination from the base and groups them with it', async () => {
            db.product.findFirst.mockResolvedValue(base);
            db.product.findMany.mockResolvedValue([]); // no SKU clashes

            await service.generate(tenantId, {
                baseProductId: 'base',
                optionNames: ['Size'],
                baseOptionValues: { Size: 'M' },
                variants: [
                    { optionValues: { Size: 'L' }, sku: 'P1-L', price: 550, initialStock: 4 },
                    { optionValues: { Size: 'XL' }, price: 600 },
                ],
            });

            const dtos = products.createMany.mock.calls[0][1];
            expect(dtos).toEqual([
                expect.objectContaining({ name: 'Belt OAC L', sku: 'P1-L', price: 550, initialStock: 4, cost: 300, groupId: 'g1', image_url: 'b.jpg', unitType: 'pcs' }),
                expect.objectContaining({ name: 'Belt OAC XL', sku: undefined, price: 600, initialStock: 0, cost: 300 }),
            ]);
            expect(db.productFamily.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ name: 'Belt OAC', option_names: ['Size'], image_url: 'b.jpg' }),
            });
            const claimed = db.product.updateMany.mock.calls.map((call: any[]) => [call[0].where.id, call[0].data.option_values]);
            expect(claimed).toEqual([
                ['base', { Size: 'M' }],
                ['new-0', { Size: 'L' }],
                ['new-1', { Size: 'XL' }],
            ]);
        });

        it("adds to the base's family on its options and refuses a size it already has", async () => {
            const family = {
                id: 'fam-1',
                name: 'Belt OAC',
                option_names: ['Size'],
                products: [{ id: 'base', option_values: { Size: 'M' } }],
            };
            db.product.findFirst.mockResolvedValue({ ...base, family });

            await expect(
                service.generate(tenantId, { baseProductId: 'base', variants: [{ optionValues: { Size: 'm' }, price: 1 }] }),
            ).rejects.toThrow(/Each variant needs its own combination/);
            expect(products.createMany).not.toHaveBeenCalled();
        });

        it('refuses a SKU already in use before making anything', async () => {
            db.product.findFirst.mockResolvedValue(base);
            db.product.findMany.mockResolvedValue([{ sku: 'P1-L' }]);

            await expect(
                service.generate(tenantId, {
                    baseProductId: 'base',
                    optionNames: ['Size'],
                    variants: [{ optionValues: { Size: 'L' }, sku: 'P1-L', price: 1 }],
                }),
            ).rejects.toThrow('SKU already in use: P1-L.');
            expect(products.createMany).not.toHaveBeenCalled();
        });

        it('refuses a service', async () => {
            db.product.findFirst.mockResolvedValue({ ...base, type: 'SERVICE' });
            await expect(
                service.generate(tenantId, { baseProductId: 'base', optionNames: ['Size'], variants: [{ optionValues: { Size: 'L' }, price: 1 }] }),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('optionValues', () => {
        it('merges options across families case-insensitively, values in size order', async () => {
            db.productFamily.findMany.mockResolvedValue([
                { option_names: ['Size'], products: [{ option_values: { Size: 'XL' } }, { option_values: { Size: 'S' } }] },
                {
                    option_names: ['size', 'Color'],
                    products: [{ option_values: { size: 'm', Color: 'Red' } }, { option_values: { size: 's', Color: 'Red' } }],
                },
            ]);

            expect(await service.optionValues(tenantId)).toEqual({ Size: ['S', 'm', 'XL'], Color: ['Red'] });
        });
    });
});
