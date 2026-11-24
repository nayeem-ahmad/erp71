import { DatabaseService } from '../src/database/database.service';
import { ProductFamiliesService } from '../src/product-families/product-families.service';
import { StorefrontService } from '../src/storefront/storefront.service';
import { ProductsService } from '../src/products/products.service';

jest.setTimeout(60_000);

/**
 * Storefront variant families against a real database: grouping, the shop
 * payload folding a family into one card, the public product page, and
 * ungrouping. Creates and deletes its own tenant only, so it can run beside the
 * other integration suites.
 */
describe('product families (integration)', () => {
    const db = new DatabaseService();
    const redis = { invalidatePattern: jest.fn(), get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const priceLists = {
        resolvePriceListForCustomer: jest.fn().mockResolvedValue(null),
        getResolvedPricesForProducts: jest.fn().mockResolvedValue(new Map()),
        addProductToAllActiveLists: jest.fn().mockResolvedValue(undefined),
    };
    const planEntitlements = { assertProductQuota: jest.fn().mockResolvedValue(undefined) };
    const productsService = new ProductsService(db, redis as never, priceLists as never, planEntitlements as never);
    const families = new ProductFamiliesService(db, redis as never, productsService);
    const storefrontPages = { resolveMenu: jest.fn().mockResolvedValue([]) };
    const nothing = {} as never;
    const storefront = new StorefrontService(
        db,
        nothing,
        priceLists as never,
        nothing,
        nothing,
        storefrontPages as never,
        nothing,
        nothing,
        nothing,
        nothing,
        nothing,
        nothing,
        nothing,
    );

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `variants-${suffix}`;
    let ownerId: string;
    let tenantId: string;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
        await db.$connect();
        const owner = await db.user.create({
            data: { email: `variants-${suffix}@test.local`, passwordHash: 'x', name: 'Variants' },
        });
        ownerId = owner.id;
        const tenant = await db.tenant.create({
            data: { name: `Variants ${suffix}`, owner_id: ownerId, storefront_slug: slug, storefront_enabled: true },
        });
        tenantId = tenant.id;
        const store = await db.store.create({ data: { tenant_id: tenantId, name: `Main ${suffix}` } });
        const warehouse = await db.warehouse.create({
            data: { tenant_id: tenantId, store_id: store.id, name: 'Main', code: 'MAIN', is_default: true },
        });

        const make = async (key: string, name: string, price: number, quantity: number) => {
            const product = await db.product.create({ data: { tenant_id: tenantId, name, price } });
            ids[key] = product.id;
            await db.productStock.create({
                data: { tenant_id: tenantId, product_id: product.id, warehouse_id: warehouse.id, quantity },
            });
        };
        await make('s', 'Belt OAC S', 500, 2);
        await make('m', 'Belt OAC M', 500, 0);
        await make('l', 'Belt OAC L', 650, 1);
        await make('cap', 'Cap', 100, 5);
    });

    afterAll(async () => {
        if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
        if (ownerId) await db.user.deleteMany({ where: { id: ownerId } }).catch(() => undefined);
        await db.$disconnect();
    });

    it('suggests the size run', async () => {
        const suggestions = await families.suggestions(tenantId);
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0].members.map((m) => m.value)).toEqual(['S', 'M', 'L']);
    });

    let familyId: string;

    it('groups them, and the shop shows one card with every size', async () => {
        const family = await families.create(tenantId, {
            name: 'Belt OAC',
            optionNames: ['Size'],
            members: [
                { productId: ids.s, optionValues: { Size: 'S' } },
                { productId: ids.m, optionValues: { Size: 'M' } },
                { productId: ids.l, optionValues: { Size: 'L' } },
            ],
        });
        familyId = family.id;
        expect(family.members).toHaveLength(3);

        const shop = await storefront.getStorefront(slug);
        expect(shop.all_products.map((card) => card.name)).toEqual(['Belt OAC', 'Cap']);
        const belt = shop.all_products[0];
        expect(belt.id).toBe(familyId);
        expect(belt.selling_price).toBe(500);
        expect(belt.price_varies).toBe(true);
        expect(belt.variants?.map((v) => [v.label, v.stock_quantity])).toEqual([
            ['S', 2],
            ['M', 0],
            ['L', 1],
        ]);
    });

    it('opens the family page on the variant a link names', async () => {
        const page = await storefront.getPublicProduct(slug, ids.m);
        expect(page.id).toBe(ids.m);
        expect(page.in_stock).toBe(false);
        expect(page.family?.id).toBe(familyId);

        const byFamily = await storefront.getPublicProduct(slug, familyId);
        expect(byFamily.id).toBe(ids.s);
    });

    it('refuses to put a grouped product in a second family', async () => {
        await expect(
            families.create(tenantId, {
                name: 'Other',
                optionNames: ['Size'],
                members: [{ productId: ids.s, optionValues: { Size: 'S' } }],
            }),
        ).rejects.toThrow(/Already a variant/);
    });

    it('drops a member on edit and clears its values', async () => {
        await families.update(tenantId, familyId, {
            members: [
                { productId: ids.s, optionValues: { Size: 'S' } },
                { productId: ids.l, optionValues: { Size: 'L' } },
            ],
        });
        const dropped = await db.product.findUnique({ where: { id: ids.m } });
        expect(dropped?.family_id).toBeNull();
        expect(dropped?.option_values).toBeNull();
    });

    it('ungroups, and the shop lists the products on their own again', async () => {
        await families.remove(tenantId, familyId);
        const shop = await storefront.getStorefront(slug);
        // M is out of stock, so sold on its own it is not listed.
        expect(shop.all_products.map((card) => card.name)).toEqual(['Belt OAC L', 'Belt OAC S', 'Cap']);
        expect(await db.productFamily.count({ where: { tenant_id: tenantId } })).toBe(0);
    });

    it('generates new sizes from a product, with stock and cost, in one family', async () => {
        const family = await families.generate(tenantId, {
            baseProductId: ids.cap,
            name: 'Cap',
            optionNames: ['Color'],
            baseOptionValues: { Color: 'Red' },
            variants: [
                { optionValues: { Color: 'Blue' }, sku: `CAP-BLUE-${suffix}`, price: 120, initialStock: 3, cost: 60 },
                { optionValues: { Color: 'Green' }, price: 110 },
            ],
        });

        expect(family.option_names).toEqual(['Color']);
        const byName = [...family.members].sort((a, b) => a.name.localeCompare(b.name));
        expect(byName.map((m) => [m.name, m.option_values.Color])).toEqual([
            ['Cap', 'Red'],
            ['Cap Blue', 'Blue'],
            ['Cap Green', 'Green'],
        ]);
        const blue = family.members.find((m) => m.name === 'Cap Blue');
        expect(blue?.stock_quantity).toBe(3);
        expect(blue?.price).toBe(120);
        const blueCost = await db.productCost.findFirst({ where: { product_id: blue!.id } });
        expect(Number(blueCost?.avg_cost)).toBe(60);
        expect(planEntitlements.assertProductQuota).toHaveBeenCalledWith(tenantId, 2);
    });

    it('adds a colour to the existing family, and rolls everything back on a clash', async () => {
        const before = await db.product.count({ where: { tenant_id: tenantId } });
        await expect(
            families.generate(tenantId, {
                baseProductId: ids.cap,
                variants: [
                    { optionValues: { Color: 'Black' }, price: 100 },
                    { optionValues: { Color: 'blue' }, price: 100 },
                ],
            }),
        ).rejects.toThrow(/own combination/);
        expect(await db.product.count({ where: { tenant_id: tenantId } })).toBe(before);

        const family = await families.generate(tenantId, {
            baseProductId: ids.cap,
            variants: [{ optionValues: { Color: 'Black' }, price: 100 }],
        });
        expect(family.members).toHaveLength(4);
    });

    describe('a product joining or leaving a group from the product form', () => {
        let shirtFamilyId: string;
        let shirtM: string;

        it('creates a product as the first variant of a new group', async () => {
            const created = await productsService.create(tenantId, {
                name: 'Shirt S',
                price: 400,
                variant: { newFamilyName: 'Shirt', optionNames: ['Size'], optionValues: { Size: 'S' } },
            });
            expect(created?.family?.name).toBe('Shirt');
            expect(created?.option_values).toEqual({ Size: 'S' });
            shirtFamilyId = created!.family!.id;
        });

        it('lets an existing product join it, and refuses a size it already has without saving the rest', async () => {
            const product = await productsService.create(tenantId, { name: 'Shirt M', price: 420 });
            shirtM = product!.id;

            await expect(
                productsService.update(tenantId, shirtM, {
                    name: 'Renamed',
                    variant: { familyId: shirtFamilyId, optionValues: { Size: 's' } },
                }),
            ).rejects.toThrow(/own combination/);
            expect((await db.product.findUnique({ where: { id: shirtM } }))?.name).toBe('Shirt M');

            const joined = await productsService.update(tenantId, shirtM, {
                variant: { familyId: shirtFamilyId, optionValues: { Size: 'M' } },
            });
            expect(joined?.family?.id).toBe(shirtFamilyId);
        });

        it('lists only ungrouped products when asked', async () => {
            const page = await productsService.findAll(tenantId, { timezone: 'Asia/Dhaka', ungrouped: true, search: 'Shirt', limit: 50 });
            expect(page.items.map((p: { name: string }) => p.name)).toEqual([]);
        });

        it('removes the group once its last product leaves', async () => {
            const first = await db.product.findFirst({ where: { tenant_id: tenantId, family_id: shirtFamilyId, id: { not: shirtM } } });
            await productsService.update(tenantId, shirtM, { leaveVariantGroup: true });
            expect((await db.product.findUnique({ where: { id: shirtM } }))?.family_id).toBeNull();
            expect(await db.productFamily.count({ where: { id: shirtFamilyId } })).toBe(1);

            await productsService.update(tenantId, first!.id, { leaveVariantGroup: true });
            expect(await db.productFamily.count({ where: { id: shirtFamilyId } })).toBe(0);
        });
    });
});

