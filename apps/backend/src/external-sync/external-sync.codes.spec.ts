import { ExternalSyncService } from './external-sync.service';

/**
 * What code an imported product or customer gets. The provider's own code when
 * it reads like one and no record of the tenant holds it; otherwise the next in
 * the tenant's series (`PRD-00001`, `CUST-00001`), never a GUID.
 */
describe('external-sync codes for new records', () => {
    const GUID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';

    const productRow = (id: number, code: string) => ({
        id,
        code,
        name: `Product ${id}`,
        purchase_rate: '0',
        sale_rate: '10.000',
        vat: '0.000',
        reorder: '0',
        is_service: 'false',
        status: 'a',
        organization_id: '262',
        updated_at: null,
    });

    const customerRow = (id: number, code: string) => ({
        id,
        code,
        name: `Customer ${id}`,
        owner_name: null,
        phone: null,
        email: null,
        address: null,
        credit_limit: null,
        previous_due: '0',
        organization_id: '262',
        updated_at: null,
    });

    function emptyStats() {
        const tally = () => ({ created: 0, updated: 0, skipped: 0 });
        return {
            products: tally(),
            customers: tally(),
            suppliers: tally(),
            sales: tally(),
            purchases: tally(),
            customerPayments: tally(),
            supplierPayments: tally(),
            saleReturns: tally(),
        };
    }

    /**
     * A tenant whose codes are `held` (live or deleted) and whose series already
     * reaches `last`. Each create bumps the series the way a real insert would.
     */
    function makeDb(opts: { held?: string[]; last?: number } = {}) {
        const held = new Set(opts.held ?? []);
        let last = opts.last ?? 0;
        const created: string[] = [];
        const holder = (code: string | undefined, where: any) =>
            // An adoption lookup only sees live rows; a code holder is anyone.
            code && held.has(code) && where.deleted_at === undefined ? { id: `holder-${code}` } : null;
        const track = (code: string) => {
            created.push(code);
            const n = /^(?:PRD|CUST|SUP)-(\d+)$/.exec(code);
            if (n) last = Math.max(last, Number(n[1]));
        };
        return {
            created,
            externalSyncMapping: {
                findMany: jest.fn(async () => []),
                upsert: jest.fn(async () => ({})),
            },
            product: {
                findFirst: jest.fn(async ({ where }: any) => holder(where.sku, where)),
                create: jest.fn(async ({ data }: any) => {
                    track(data.sku);
                    return { id: `product-${data.sku}` };
                }),
            },
            customer: {
                findFirst: jest.fn(async ({ where }: any) => holder(where.customer_code, where)),
                create: jest.fn(async ({ data }: any) => {
                    track(data.customer_code);
                    return { id: `customer-${data.customer_code}` };
                }),
            },
            supplier: {
                // Adoption is by name, and no supplier of this tenant shares one.
                findFirst: jest.fn(async ({ where }: any) => (where.name ? null : holder(where.supplier_code, where))),
                create: jest.fn(async ({ data }: any) => {
                    track(data.supplier_code);
                    return { id: `supplier-${data.supplier_code}` };
                }),
            },
            productCost: { findMany: jest.fn(async () => []) },
            productPrice: { findMany: jest.fn(async () => []) },
            $queryRaw: jest.fn(async () => [{ last: String(last) }]),
        } as any;
    }

    const connection = { id: 'conn-1', tenant_id: 'tenant-1', store_id: 'store-1', provider: 'EXPRESS_RETAIL', post_impacts: false };

    it("keeps a product's readable SKU and numbers a GUID one, a repeat getting -2", async () => {
        const db = makeDb({ last: 3 });
        const service = new ExternalSyncService(db, {} as any, {} as any);
        const client = { fetchProducts: jest.fn(async () => [productRow(1, 'P01212'), productRow(2, GUID), productRow(3, 'P01212'), productRow(4, '')]) } as any;

        await (service as any).syncProducts(connection, client, emptyStats(), [], false);

        expect(db.created).toEqual(['P01212', 'PRD-00004', 'P01212-2', 'PRD-00005']);
    });

    it('numbers a product whose SKU a deleted product still holds', async () => {
        const db = makeDb({ held: ['P01212'] });
        const service = new ExternalSyncService(db, {} as any, {} as any);
        const client = { fetchProducts: jest.fn(async () => [productRow(1, 'P01212')]) } as any;
        const stats = emptyStats();

        await (service as any).syncProducts(connection, client, stats, [], false);

        expect(db.created).toEqual(['PRD-00001']);
        expect(stats.products.created).toBe(1);
    });

    it("keeps a customer's readable code and numbers a GUID or blank one", async () => {
        const db = makeDb({ held: ['C9'], last: 41 });
        const service = new ExternalSyncService(db, {} as any, {} as any);
        const client = { fetchCustomers: jest.fn(async () => [customerRow(1, 'C00564'), customerRow(2, GUID), customerRow(3, 'C9'), customerRow(4, '')]) } as any;
        const warnings: any[] = [];

        await (service as any).syncCustomers(connection, client, emptyStats(), warnings, false, new Date('2026-01-01'));

        expect(db.created).toEqual(['C00564', 'CUST-00042', 'CUST-00043', 'CUST-00044']);
        expect(warnings).toEqual([]);
    });

    it("keeps a supplier's readable code and numbers a GUID, blank or repeated-elsewhere one", async () => {
        const db = makeDb({ held: ['S9'] });
        const service = new ExternalSyncService(db, {} as any, {} as any);
        const supplierRow = (id: number, code: string) => ({
            id, code, name: `Supplier ${id}`, phone: null, email: null, address: null, previous_due: '0', organization_id: '262', updated_at: null,
        });
        const client = { fetchSuppliers: jest.fn(async () => [supplierRow(1, 'S1'), supplierRow(2, GUID), supplierRow(3, 'S9'), supplierRow(4, 'S1')]) } as any;

        await (service as any).syncSuppliers(connection, client, emptyStats(), [], false, new Date('2026-01-01'));

        expect(db.created).toEqual(['S1', 'SUP-00001', 'SUP-00002', 'S1-2']);
    });
});
