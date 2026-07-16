import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { bootstrapDefaultAccountingForTenant } from '@erp71/database';
import { DatabaseService } from '../src/database/database.service';
import { runSimulation } from '../src/demo-data/generator/simulate';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

jest.setTimeout(180_000);

/**
 * Integration test for the six-month demo-data generator. Runs a short window
 * (three weeks) against a real database and asserts the properties that make the
 * dataset trustworthy: the trial balance balances because it was *derived*, the
 * stock ledger agrees with on-hand, party dues reconcile, and — the regression
 * that motivated approach B — backdated transactions are actually backdated.
 *
 * Requires a reachable DATABASE_URL with the schema pushed. Runs in CI, which
 * provisions a clean DB first.
 */
describe('Demo-data generator (integration)', () => {
    const db = new DatabaseService();
    let tenantId: string;
    let userId: string;
    const now = new Date();
    const windowDays = 21;
    const startMidnight = (() => {
        const s = new Date(now);
        s.setDate(s.getDate() - windowDays);
        return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
    })();

    beforeAll(async () => {
        await db.$connect();

        const suffix = Date.now();
        const user = await db.user.create({
            data: { email: `demo-int-${suffix}@test.local`, passwordHash: 'x', name: 'Demo Int' },
        });
        userId = user.id;
        const tenant = await db.tenant.create({ data: { name: `Demo Int ${suffix}`, owner_id: user.id } });
        tenantId = tenant.id;

        const mainStore = await db.store.create({ data: { tenant_id: tenantId, name: 'Main', address: 'Dhaka' } });
        const bananiStore = await db.store.create({ data: { tenant_id: tenantId, name: 'Banani', address: 'Dhaka' } });
        const mainWh = await db.warehouse.create({
            data: { tenant_id: tenantId, store_id: mainStore.id, name: 'Main WH', code: `WH-${suffix}-1`, is_default: true, is_active: true },
        });
        await db.warehouse.create({
            data: { tenant_id: tenantId, store_id: bananiStore.id, name: 'Banani WH', code: `WH-${suffix}-2`, is_default: true, is_active: true },
        });
        await db.inventorySettings.create({
            data: {
                tenant_id: tenantId,
                default_product_warehouse_id: mainWh.id,
                default_purchase_warehouse_id: mainWh.id,
                default_sales_warehouse_id: mainWh.id,
                default_shrinkage_warehouse_id: mainWh.id,
                default_transfer_source_warehouse_id: mainWh.id,
                default_transfer_destination_warehouse_id: mainWh.id,
            },
        });
        const shrinkageReasons = [
            { code: 'THEFT', label: 'Theft' },
            { code: 'DAMAGE', label: 'Damage' },
            { code: 'EXPIRATION', label: 'Expiration' },
            { code: 'UNKNOWN', label: 'Unknown Loss' },
        ];
        for (const [i, r] of shrinkageReasons.entries()) {
            await db.inventoryReason.create({
                data: { tenant_id: tenantId, type: 'SHRINKAGE', code: r.code, label: r.label, is_active: true, is_system: true, display_order: i },
            });
        }
        await bootstrapDefaultAccountingForTenant(db, tenantId);

        await runSimulation({ db, tenantId, userId, batchNumber: 1, now, windowDays });
    });

    afterAll(async () => {
        // Best-effort cleanup of the throwaway tenant.
        if (tenantId) {
            await db.$executeRawUnsafe('DELETE FROM voucher_details WHERE voucher_id IN (SELECT id FROM vouchers WHERE tenant_id = $1)', tenantId).catch(() => undefined);
        }
        await db.$disconnect();
    });

    it('generates a non-trivial dataset', async () => {
        const sales = await db.sale.count({ where: { tenant_id: tenantId } });
        const vouchers = await db.voucher.count({ where: { tenant_id: tenantId } });
        expect(sales).toBeGreaterThan(0);
        expect(vouchers).toBeGreaterThan(0);
    });

    it('total debits equal total credits across all vouchers', async () => {
        const sums = await db.voucherDetail.aggregate({
            where: { voucher: { tenant_id: tenantId } },
            _sum: { debit_amount: true, credit_amount: true },
        });
        const debits = Number(sums._sum.debit_amount ?? 0);
        const credits = Number(sums._sum.credit_amount ?? 0);
        expect(debits).toBeGreaterThan(0);
        expect(Math.abs(debits - credits)).toBeLessThan(0.01);
    });

    it('every ProductStock quantity equals the sum of its inventory movements', async () => {
        const stocks = await db.productStock.findMany({ where: { tenant_id: tenantId } });
        expect(stocks.length).toBeGreaterThan(0);
        for (const stock of stocks) {
            const agg = await db.inventoryMovement.aggregate({
                where: { tenant_id: tenantId, product_id: stock.product_id, warehouse_id: stock.warehouse_id },
                _sum: { quantity_delta: true },
            });
            expect(stock.quantity).toBe(agg._sum.quantity_delta ?? 0);
        }
    });

    // The `amount` column is a positive magnitude whose effect on the running
    // balance depends on type (PAYMENT reduces due; everything else my generator
    // writes — CREDIT_SALE/CREDIT_PURCHASE and already-signed ADJUSTMENT — adds),
    // exactly as the real customers/suppliers services store it.
    const signedDue = (rows: Array<{ type: string; amount: unknown }>): number =>
        rows.reduce((sum, r) => sum + (r.type === 'PAYMENT' ? -Number(r.amount) : Number(r.amount)), 0);

    it('customer due balances reconcile with their credit ledger', async () => {
        const customers = await db.customer.findMany({ where: { tenant_id: tenantId } });
        for (const customer of customers) {
            const txns = await db.customerCreditTransaction.findMany({
                where: { tenant_id: tenantId, customer_id: customer.id },
                select: { type: true, amount: true },
            });
            expect(Math.abs(Number(customer.due_balance) - signedDue(txns))).toBeLessThan(0.01);
        }
    });

    it('supplier due balances reconcile with their credit ledger', async () => {
        const suppliers = await db.supplier.findMany({ where: { tenant_id: tenantId } });
        for (const supplier of suppliers) {
            const txns = await db.supplierCreditTransaction.findMany({
                where: { tenant_id: tenantId, supplier_id: supplier.id },
                select: { type: true, amount: true },
            });
            expect(Math.abs(Number(supplier.due_balance) - signedDue(txns))).toBeLessThan(0.01);
        }
    });

    it('every generated date falls within the simulated window', async () => {
        const lowerBound = new Date(startMidnight.getTime() - 2 * 86400000); // allow ProductPrice effective_from (start - 1d)
        const upperBound = new Date(now.getTime() + 60_000);

        const voucherRange = await db.voucher.aggregate({ where: { tenant_id: tenantId }, _min: { date: true }, _max: { date: true } });
        const movementRange = await db.inventoryMovement.aggregate({ where: { tenant_id: tenantId }, _min: { created_at: true }, _max: { created_at: true } });
        const saleRange = await db.sale.aggregate({ where: { tenant_id: tenantId }, _min: { sale_date: true }, _max: { sale_date: true } });

        for (const range of [voucherRange, movementRange]) {
            const min = (range._min as any).date ?? (range._min as any).created_at;
            const max = (range._max as any).date ?? (range._max as any).created_at;
            expect(min.getTime()).toBeGreaterThanOrEqual(lowerBound.getTime());
            expect(max.getTime()).toBeLessThanOrEqual(upperBound.getTime());
        }
        expect(saleRange._min.sale_date!.getTime()).toBeGreaterThanOrEqual(lowerBound.getTime());
        expect(saleRange._max.sale_date!.getTime()).toBeLessThanOrEqual(upperBound.getTime());
    });

    it('backdates vouchers, movements, and payments — not stamped "today"', async () => {
        // The regression that motivated approach B: a backdated sale used to land
        // its voucher/movement/payment at the current timestamp. If that were
        // still true, every row would cluster at `now`. Assert instead that early
        // rows are genuinely dated near the start of the window.
        const fiveDaysBeforeEnd = new Date(now.getTime() - 5 * 86400000);

        const oldVoucher = await db.voucher.findFirst({ where: { tenant_id: tenantId, date: { lt: fiveDaysBeforeEnd } } });
        const oldMovement = await db.inventoryMovement.findFirst({ where: { tenant_id: tenantId, created_at: { lt: fiveDaysBeforeEnd } } });
        const oldPayment = await db.paymentRecord.findFirst({
            where: { sale: { tenant_id: tenantId }, created_at: { lt: fiveDaysBeforeEnd } },
        });

        expect(oldVoucher).not.toBeNull();
        expect(oldMovement).not.toBeNull();
        expect(oldPayment).not.toBeNull();
    });
});
