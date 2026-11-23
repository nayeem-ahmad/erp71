import { DatabaseService } from '../src/database/database.service';
import { ProductFamiliesService } from '../src/product-families/product-families.service';
import { StorefrontService } from '../src/storefront/storefront.service';

jest.setTimeout(60_000);

/**
 * Storefront variant families against a real database: grouping, the shop
 * payload folding a family into one card, the public product page, and
 * ungrouping. Creates and deletes its own tenant only, so it can run beside the
 * other integration suites.
 */
describe('product families (integration)', () => {
    const db = new DatabaseService();
    const redis = { invalidatePattern: jest.fn() };
    const families = new ProductFamiliesService(db, redis as never);
    const priceLists = {
        resolvePriceListForCustomer: jest.fn().mockResolvedValue(null),
        getResolvedPricesForProducts: jest.fn().mockResolvedValue(new Map()),
    };
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
});
