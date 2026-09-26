import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { DatabaseService } from '../src/database/database.service';
import { SalesLineItemsService } from '../src/sales-reports/sales-line-items.service';
import { PurchaseLineItemsService } from '../src/purchase-reports/purchase-line-items.service';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

jest.setTimeout(60_000);

const TZ = 'Asia/Dhaka';
const MARCH = { from: '2026-03-01', to: '2026-03-31' };

/**
 * The line-item searches against a real database.
 *
 * The unit specs pin the filter objects the services build; this pins that
 * Prisma accepts them and that Postgres answers them as intended — the nested
 * relation sorts, the grouped price sum, the "sales with a matching line"
 * count and the relation filter on returns are all shapes a mocked client
 * would wave through whether or not they run.
 *
 * Seeds its own throwaway tenants and removes them afterwards. Requires a
 * reachable DATABASE_URL with the schema pushed, as the other suites here do.
 */
describe('Line-item reports (integration)', () => {
    const db = new DatabaseService();
    const salesReport = new SalesLineItemsService(db);
    const purchaseReport = new PurchaseLineItemsService(db);

    let userId: string;
    let tenantId: string;
    let otherTenantId: string;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
        await db.$connect();

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const user = await db.user.create({
            data: { email: `line-items-${suffix}@test.local`, passwordHash: 'x', name: 'Line Items' },
        });
        userId = user.id;
        tenantId = (await db.tenant.create({ data: { name: `Line Items ${suffix}`, owner_id: userId } })).id;
        otherTenantId = (await db.tenant.create({ data: { name: `Line Items Other ${suffix}`, owner_id: userId } })).id;

        const main = await db.store.create({ data: { tenant_id: tenantId, name: 'Main' } });
        const banani = await db.store.create({ data: { tenant_id: tenantId, name: 'Banani' } });
        const otherStore = await db.store.create({ data: { tenant_id: otherTenantId, name: 'Main' } });
        ids.main = main.id;
        ids.banani = banani.id;

        const rahim = await db.customer.create({
            data: { tenant_id: tenantId, customer_code: 'C-1', name: 'Rahim Uddin', phone: '01711000001' },
        });
        const karim = await db.customer.create({
            data: { tenant_id: tenantId, customer_code: 'C-2', name: 'Karim Ahmed', phone: '01711000002' },
        });
        ids.rahim = rahim.id;
        ids.karim = karim.id;

        const rice = await db.product.create({ data: { tenant_id: tenantId, name: 'Miniket Rice 5kg', sku: 'RICE-5' } });
        const oil = await db.product.create({ data: { tenant_id: tenantId, name: 'Soybean Oil 1L', sku: 'OIL-1' } });
        // Same name and SKU in another workspace: must never leak across.
        const otherRice = await db.product.create({
            data: { tenant_id: otherTenantId, name: 'Miniket Rice 5kg', sku: 'RICE-5' },
        });
        ids.rice = rice.id;
        ids.oil = oil.id;
        ids.otherRice = otherRice.id;

        const sale = (data: {
            serial: string;
            storeId: string;
            customerId?: string;
            date: string;
            status?: string;
            reference?: string;
            tenant?: string;
            lines: Array<{ productId: string; quantity: number; price: number }>;
        }) =>
            db.sale.create({
                data: {
                    tenant_id: data.tenant ?? tenantId,
                    store_id: data.storeId,
                    customer_id: data.customerId ?? null,
                    serial_number: data.serial,
                    reference_number: data.reference ?? null,
                    status: data.status ?? 'COMPLETED',
                    sale_date: new Date(data.date),
                    total_amount: data.lines.reduce((sum, l) => sum + l.quantity * l.price, 0),
                    items: {
                        create: data.lines.map((l) => ({
                            product_id: l.productId,
                            quantity: l.quantity,
                            price_at_sale: l.price,
                        })),
                    },
                },
                include: { items: true },
            });

        // 2 March in Dhaka, although still 1 March in UTC.
        const s1 = await sale({
            serial: 'S-1001',
            storeId: main.id,
            customerId: rahim.id,
            date: '2026-03-01T20:00:00Z',
            lines: [
                { productId: rice.id, quantity: 2, price: 500 },
                { productId: oil.id, quantity: 3, price: 180 },
            ],
        });
        await sale({
            serial: 'S-1002',
            storeId: banani.id,
            customerId: karim.id,
            reference: 'INV-77',
            date: '2026-03-05T06:00:00Z',
            lines: [{ productId: rice.id, quantity: 1, price: 520 }],
        });
        // Void and not-yet-a-sale: neither is a sale line.
        await sale({
            serial: 'S-1003',
            storeId: main.id,
            status: 'CANCELLED',
            date: '2026-03-10T06:00:00Z',
            lines: [{ productId: rice.id, quantity: 10, price: 500 }],
        });
        await sale({
            serial: 'S-1004',
            storeId: main.id,
            customerId: rahim.id,
            status: 'DRAFT',
            date: '2026-03-12T06:00:00Z',
            lines: [{ productId: oil.id, quantity: 1, price: 180 }],
        });
        // 31 March in UTC, but 1 April in Dhaka — outside a March window.
        await sale({
            serial: 'S-1006',
            storeId: main.id,
            date: '2026-03-31T19:00:00Z',
            lines: [{ productId: rice.id, quantity: 7, price: 500 }],
        });
        await sale({
            serial: 'S-9001',
            tenant: otherTenantId,
            storeId: otherStore.id,
            date: '2026-03-05T06:00:00Z',
            lines: [{ productId: otherRice.id, quantity: 99, price: 1 }],
        });

        // One of the three oil bottles came back.
        const oilLine = s1.items.find((item) => item.product_id === oil.id)!;
        ids.s1OilLine = oilLine.id;
        await db.salesReturn.create({
            data: {
                tenant_id: tenantId,
                store_id: main.id,
                sale_id: s1.id,
                return_number: 'SR-1',
                total_refund: 180,
                items: {
                    create: [{ sale_item_id: oilLine.id, product_id: oil.id, quantity: 1, refund_amount: 180 }],
                },
            },
        });

        const rahman = await db.supplier.create({
            data: { tenant_id: tenantId, name: 'Rahman Traders', phone: '01811000001' },
        });
        const ctgOils = await db.supplier.create({ data: { tenant_id: tenantId, name: 'Chittagong Oils' } });
        ids.rahman = rahman.id;

        const purchase = (data: {
            number: string;
            storeId: string;
            supplierId: string;
            date: string;
            status?: string;
            reference?: string;
            lines: Array<{ productId: string; quantity: number; cost: number }>;
        }) =>
            db.purchase.create({
                data: {
                    tenant_id: tenantId,
                    store_id: data.storeId,
                    supplier_id: data.supplierId,
                    purchase_number: data.number,
                    reference_number: data.reference ?? null,
                    status: data.status ?? 'RECORDED',
                    created_at: new Date(data.date),
                    total_amount: data.lines.reduce((sum, l) => sum + l.quantity * l.cost, 0),
                    items: {
                        create: data.lines.map((l) => ({
                            product_id: l.productId,
                            quantity: l.quantity,
                            unit_cost: l.cost,
                            line_total: l.quantity * l.cost,
                        })),
                    },
                },
                include: { items: true },
            });

        const p1 = await purchase({
            number: 'P-1',
            storeId: main.id,
            supplierId: rahman.id,
            reference: 'BILL-9',
            date: '2026-03-03T05:00:00Z',
            lines: [
                { productId: rice.id, quantity: 10, cost: 450 },
                { productId: oil.id, quantity: 20, cost: 160 },
            ],
        });
        await purchase({
            number: 'P-2',
            storeId: banani.id,
            supplierId: ctgOils.id,
            date: '2026-03-08T05:00:00Z',
            lines: [{ productId: oil.id, quantity: 5, cost: 165 }],
        });
        await purchase({
            number: 'P-3',
            storeId: main.id,
            supplierId: rahman.id,
            status: 'CANCELLED',
            date: '2026-03-09T05:00:00Z',
            lines: [{ productId: rice.id, quantity: 100, cost: 400 }],
        });

        const riceLine = p1.items.find((item) => item.product_id === rice.id)!;
        ids.p1RiceLine = riceLine.id;
        await db.purchaseReturn.create({
            data: {
                tenant_id: tenantId,
                store_id: main.id,
                purchase_id: p1.id,
                supplier_id: rahman.id,
                return_number: 'PR-1',
                total_amount: 900,
                items: {
                    create: [{ purchase_item_id: riceLine.id, product_id: rice.id, quantity: 2, unit_cost: 450, line_total: 900 }],
                },
            },
        });
    });

    afterAll(async () => {
        const tenants = { in: [tenantId, otherTenantId].filter(Boolean) };
        try {
            await db.salesReturnItem.deleteMany({ where: { return: { tenant_id: tenants } } });
            await db.salesReturn.deleteMany({ where: { tenant_id: tenants } });
            await db.saleItem.deleteMany({ where: { sale: { tenant_id: tenants } } });
            await db.sale.deleteMany({ where: { tenant_id: tenants } });
            await db.purchaseReturnItem.deleteMany({ where: { purchaseReturn: { tenant_id: tenants } } });
            await db.purchaseReturn.deleteMany({ where: { tenant_id: tenants } });
            await db.purchaseItem.deleteMany({ where: { purchase: { tenant_id: tenants } } });
            await db.purchase.deleteMany({ where: { tenant_id: tenants } });
            await db.product.deleteMany({ where: { tenant_id: tenants } });
            await db.customer.deleteMany({ where: { tenant_id: tenants } });
            await db.supplier.deleteMany({ where: { tenant_id: tenants } });
            await db.store.deleteMany({ where: { tenant_id: tenants } });
            await db.tenant.deleteMany({ where: { id: tenants } });
            if (userId) await db.user.delete({ where: { id: userId } });
        } finally {
            await db.$disconnect();
        }
    });

    describe('sales', () => {
        it('lists every completed line in the window, in the shop’s own days, with period totals', async () => {
            const report = await salesReport.getSalesLineItems(tenantId, { ...MARCH }, TZ);

            // S-1003 is cancelled, S-1004 a draft, S-1006 falls on 1 April in
            // Dhaka and S-9001 belongs to another workspace.
            expect(report.rows.map((row) => `${row.invoiceNumber}:${row.product.sku}`).sort()).toEqual([
                'S-1001:OIL-1',
                'S-1001:RICE-5',
                'S-1002:RICE-5',
            ]);
            expect(report.summary).toEqual({
                lineCount: 3,
                invoiceCount: 2,
                quantity: 6,
                amount: 2060,
                returnedQuantity: 1,
                returnedAmount: 180,
            });
            expect(report.pagination).toEqual({ page: 1, limit: 25, total: 3, pages: 1 });
        });

        it('draws the day boundary at Dhaka midnight, not UTC midnight', async () => {
            const april = await salesReport.getSalesLineItems(tenantId, { from: '2026-04-01', to: '2026-04-01' }, TZ);
            expect(april.rows.map((row) => row.invoiceNumber)).toEqual(['S-1006']);

            const firstOfMarch = await salesReport.getSalesLineItems(tenantId, { from: '2026-03-01', to: '2026-03-01' }, TZ);
            expect(firstOfMarch.rows).toHaveLength(0);
        });

        it('opens newest first and says what came back against each line', async () => {
            const report = await salesReport.getSalesLineItems(tenantId, { ...MARCH }, TZ);

            expect(report.rows[0].invoiceNumber).toBe('S-1002');
            const oil = report.rows.find((row) => row.id === ids.s1OilLine)!;
            expect(oil).toMatchObject({
                quantity: 3,
                unitPrice: 180,
                amount: 540,
                returnedQuantity: 1,
                returnedAmount: 180,
                customer: { id: ids.rahim, name: 'Rahim Uddin' },
                store: { id: ids.main, name: 'Main' },
            });
        });

        it('narrows by customer, product and branch, and names what it was narrowed by', async () => {
            const byCustomer = await salesReport.getSalesLineItems(tenantId, { ...MARCH, customerId: ids.rahim }, TZ);
            expect(byCustomer.rows).toHaveLength(2);
            expect(byCustomer.summary.invoiceCount).toBe(1);
            expect(byCustomer.filters.customer).toMatchObject({ id: ids.rahim, name: 'Rahim Uddin' });

            const byProduct = await salesReport.getSalesLineItems(tenantId, { ...MARCH, productId: ids.rice }, TZ);
            expect(byProduct.summary).toMatchObject({ lineCount: 2, invoiceCount: 2, quantity: 3, amount: 1520 });
            expect(byProduct.filters.product).toMatchObject({ id: ids.rice, sku: 'RICE-5' });

            const byBranch = await salesReport.getSalesLineItems(tenantId, { ...MARCH, storeId: ids.banani }, TZ);
            expect(byBranch.rows.map((row) => row.invoiceNumber)).toEqual(['S-1002']);
        });

        it('searches product, invoice and reference numbers, and the customer by name or phone', async () => {
            const search = async (term: string) =>
                (await salesReport.getSalesLineItems(tenantId, { ...MARCH, search: term }, TZ)).rows
                    .map((row) => `${row.invoiceNumber}:${row.product.sku}`)
                    .sort();

            expect(await search('soybean')).toEqual(['S-1001:OIL-1']);
            expect(await search('rice-5')).toEqual(['S-1001:RICE-5', 'S-1002:RICE-5']);
            expect(await search('inv-77')).toEqual(['S-1002:RICE-5']);
            expect(await search('S-1001')).toEqual(['S-1001:OIL-1', 'S-1001:RICE-5']);
            expect(await search('karim')).toEqual(['S-1002:RICE-5']);
            expect(await search('01711000001')).toEqual(['S-1001:OIL-1', 'S-1001:RICE-5']);
        });

        it('keeps another workspace’s ids from matching anything', async () => {
            const report = await salesReport.getSalesLineItems(tenantId, { productId: ids.otherRice }, TZ);
            expect(report.rows).toHaveLength(0);
            expect(report.summary.lineCount).toBe(0);
            expect(report.filters.product).toBeNull();
        });

        it('sorts on columns of the line, the product and the customer, and pages without gaps', async () => {
            const byProduct = await salesReport.getSalesLineItems(
                tenantId,
                { ...MARCH, sortBy: 'product', sortDir: 'asc' },
                TZ,
            );
            expect(byProduct.rows.map((row) => row.product.name)).toEqual([
                'Miniket Rice 5kg',
                'Miniket Rice 5kg',
                'Soybean Oil 1L',
            ]);

            const byCustomer = await salesReport.getSalesLineItems(
                tenantId,
                { ...MARCH, sortBy: 'customer', sortDir: 'asc' },
                TZ,
            );
            expect(byCustomer.rows[0].customer?.name).toBe('Karim Ahmed');

            const byPrice = await salesReport.getSalesLineItems(
                tenantId,
                { ...MARCH, sortBy: 'unitPrice', sortDir: 'desc' },
                TZ,
            );
            expect(byPrice.rows.map((row) => row.unitPrice)).toEqual([520, 500, 180]);

            const first = await salesReport.getSalesLineItems(tenantId, { ...MARCH, limit: 2, page: 1 }, TZ);
            const second = await salesReport.getSalesLineItems(tenantId, { ...MARCH, limit: 2, page: 2 }, TZ);
            expect(first.pagination).toEqual({ page: 1, limit: 2, total: 3, pages: 2 });
            expect(first.rows).toHaveLength(2);
            expect(second.rows).toHaveLength(1);
            const seen = [...first.rows, ...second.rows].map((row) => row.id);
            expect(new Set(seen).size).toBe(3);
        });
    });

    describe('purchases', () => {
        it('lists every line of the bills that still stand, with period totals', async () => {
            const report = await purchaseReport.getPurchaseLineItems(tenantId, { ...MARCH }, TZ);

            // P-3 is cancelled.
            expect(report.rows.map((row) => `${row.purchaseNumber}:${row.product.sku}`).sort()).toEqual([
                'P-1:OIL-1',
                'P-1:RICE-5',
                'P-2:OIL-1',
            ]);
            expect(report.summary).toEqual({
                lineCount: 3,
                billCount: 2,
                quantity: 35,
                amount: 8525,
                returnedQuantity: 2,
                returnedAmount: 900,
            });

            const rice = report.rows.find((row) => row.id === ids.p1RiceLine)!;
            expect(rice).toMatchObject({
                quantity: 10,
                unitCost: 450,
                amount: 4500,
                returnedQuantity: 2,
                returnedAmount: 900,
                referenceNumber: 'BILL-9',
                supplier: { id: ids.rahman, name: 'Rahman Traders' },
            });
        });

        it('narrows by supplier and searches the supplier’s own bill number', async () => {
            const bySupplier = await purchaseReport.getPurchaseLineItems(
                tenantId,
                { ...MARCH, supplierId: ids.rahman },
                TZ,
            );
            expect(bySupplier.rows.map((row) => row.purchaseNumber)).toEqual(['P-1', 'P-1']);
            expect(bySupplier.summary.billCount).toBe(1);
            expect(bySupplier.filters.supplier).toMatchObject({ id: ids.rahman, name: 'Rahman Traders' });

            const byReference = await purchaseReport.getPurchaseLineItems(tenantId, { ...MARCH, search: 'bill-9' }, TZ);
            expect(byReference.rows).toHaveLength(2);

            const bySupplierName = await purchaseReport.getPurchaseLineItems(
                tenantId,
                { ...MARCH, search: 'chittagong' },
                TZ,
            );
            expect(bySupplierName.rows.map((row) => row.purchaseNumber)).toEqual(['P-2']);
        });

        it('sorts by line value and by supplier', async () => {
            const byAmount = await purchaseReport.getPurchaseLineItems(
                tenantId,
                { ...MARCH, sortBy: 'amount', sortDir: 'desc' },
                TZ,
            );
            expect(byAmount.rows.map((row) => row.amount)).toEqual([4500, 3200, 825]);

            const bySupplier = await purchaseReport.getPurchaseLineItems(
                tenantId,
                { ...MARCH, sortBy: 'supplier', sortDir: 'asc' },
                TZ,
            );
            expect(bySupplier.rows[0].supplier?.name).toBe('Chittagong Oils');
        });
    });
});
