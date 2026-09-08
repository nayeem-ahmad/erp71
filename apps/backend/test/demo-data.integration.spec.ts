import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { bootstrapDefaultAccountingForTenant } from '@erp71/database';
import { DatabaseService } from '../src/database/database.service';
import { runSimulation, type SimulationResult } from '../src/demo-data/generator/simulate';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

jest.setTimeout(180_000);

/**
 * Integration test for the demo-data generator. Runs a short window (three weeks)
 * against a real database and asserts the properties that make the dataset
 * trustworthy: the trial balance balances because it was *derived*, the stock
 * ledger agrees with on-hand, party dues reconcile, and — the regression that
 * motivated approach B — backdated transactions are actually backdated.
 *
 * It also asserts the two things the breadth of the generator rests on: that
 * every module group actually writes rows, and that a planted anomaly is odd as
 * business without being inconsistent as data.
 *
 * Requires a reachable DATABASE_URL with the schema pushed. Runs in CI, which
 * provisions a clean DB first.
 */
describe('Demo-data generator (integration)', () => {
    const db = new DatabaseService();
    let tenantId: string;
    let userId: string;
    let result: SimulationResult;
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

        result = await runSimulation({ db, tenantId, userId, batchNumber: 1, now, windowDays });
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

    it('every voucher line on a party-control account carries a party_id', async () => {
        // The party dimension is only meaningful if it is never missing: an
        // untagged line on Accounts Receivable / Purchase Payable is a receivable
        // or payable belonging to nobody, invisible in every subsidiary ledger.
        const controlAccounts = await db.account.findMany({
            where: { tenant_id: tenantId, party_type: { not: null } },
            select: { id: true },
        });
        expect(controlAccounts.length).toBeGreaterThan(0);

        const untagged = await db.voucherDetail.count({
            where: {
                voucher: { tenant_id: tenantId },
                account_id: { in: controlAccounts.map((a) => a.id) },
                party_id: null,
            },
        });
        expect(untagged).toBe(0);
    });

    it('every party_id on a control account resolves to a real party of the right type', async () => {
        // party_id is polymorphic and NOT a foreign key, so nothing at the DB level
        // stops a customer id landing on Purchase Payable. This is the check that a
        // caller passed the RIGHT party: the receivable carries only real customer
        // ids, the payable only real supplier ids. Cross-contamination — the one
        // failure mode the unit tests cannot see across module boundaries — fails
        // here. (Deliberately not an amount check: GL legitimately diverges from the
        // clamped due_balance/credit tracker when a return exceeds what is owed.)
        const [ar, payable] = await Promise.all([
            db.account.findFirst({ where: { tenant_id: tenantId, name: 'Accounts Receivable' }, select: { id: true } }),
            db.account.findFirst({ where: { tenant_id: tenantId, name: 'Purchase Payable' }, select: { id: true } }),
        ]);

        const partyIdsOn = async (accountId: string) => {
            const rows = await db.voucherDetail.findMany({
                where: { voucher: { tenant_id: tenantId }, account_id: accountId },
                select: { party_id: true },
                distinct: ['party_id'],
            });
            return rows.map((r) => r.party_id!).filter(Boolean);
        };

        const customerIds = await partyIdsOn(ar!.id);
        const supplierIds = await partyIdsOn(payable!.id);
        expect(customerIds.length).toBeGreaterThan(0);
        expect(supplierIds.length).toBeGreaterThan(0);

        const [realCustomers, realSuppliers] = await Promise.all([
            db.customer.count({ where: { tenant_id: tenantId, id: { in: customerIds } } }),
            db.supplier.count({ where: { tenant_id: tenantId, id: { in: supplierIds } } }),
        ]);
        // Every id present must resolve — no supplier id on AR, no customer id on AP.
        expect(realCustomers).toBe(customerIds.length);
        expect(realSuppliers).toBe(supplierIds.length);
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

    it('writes rows for every module group, not just core trading', async () => {
        // The point of the module groups is that each one actually populates its
        // pages. A group that silently writes nothing would leave a demo store
        // with an empty module and no signal that anything went wrong.
        const perGroup: Record<string, number> = {
            core: await db.sale.count({ where: { tenant_id: tenantId } }),
            sales: await db.quotation.count({ where: { tenant_id: tenantId } })
                + await db.salesOrder.count({ where: { tenant_id: tenantId } }),
            purchasing: await db.purchaseOrder.count({ where: { tenant_id: tenantId } })
                + await db.productDemand.count({ where: { tenant_id: tenantId } }),
            inventory: await db.warehouseTransfer.count({ where: { tenant_id: tenantId } })
                + await db.inventoryShrinkage.count({ where: { tenant_id: tenantId } }),
            crm: await db.lead.count({ where: { tenant_id: tenantId } }),
            hr: await db.attendanceRecord.count({ where: { tenant_id: tenantId } }),
            finance: await db.fixedAsset.count({ where: { tenant_id: tenantId } }),
            operations: await db.project.count({ where: { tenant_id: tenantId } }),
        };
        // Assert on the list of empty groups rather than one count at a time, so
        // a failure names which module went missing.
        const empty = Object.entries(perGroup).filter(([, count]) => count === 0).map(([group]) => group);
        expect(empty).toEqual([]);
    });

    it('plants anomalies and reports exactly what it planted', async () => {
        expect(result.anomalies.length).toBeGreaterThan(0);
        expect(result.counts.anomalies).toBe(result.anomalies.length);

        for (const anomaly of result.anomalies) {
            expect(anomaly.detail.length).toBeGreaterThan(0);
            expect(anomaly.hint.length).toBeGreaterThan(0);
            expect(new Date(anomaly.occurredAt).getTime()).toBeGreaterThanOrEqual(startMidnight.getTime());
            expect(new Date(anomaly.occurredAt).getTime()).toBeLessThanOrEqual(now.getTime() + 60_000);
        }

        // Every anomaly points at a row that exists: the list is an answer key a
        // presenter opens, not a description of something that got rolled back.
        for (const sale of result.anomalies.filter((a) => a.entity === 'Sale')) {
            const row = await db.sale.findUnique({ where: { id: sale.entityId } });
            expect(row?.tenant_id).toBe(tenantId);
            expect(row?.note).toContain('Demo anomaly');
        }
    });

    it('keeps a below-cost sale odd as business but consistent as data', async () => {
        // The whole design rests on this: an anomaly is written through the same
        // primitives as an ordinary row, so it dents the margin report without
        // breaking the ledger. (Asserted alongside the trial-balance and stock
        // invariants above, which cover the same dataset.)
        const belowCost = result.anomalies.find((a) => a.kind === 'BELOW_COST_SALE');
        if (!belowCost) return; // Rate-limited: a three-week window may miss one.

        const items = await db.saleItem.findMany({ where: { sale_id: belowCost.entityId } });
        expect(items.length).toBeGreaterThan(0);
        expect(items.some((item) => Number(item.price_at_sale) < Number(item.unit_cost_at_sale))).toBe(true);

        const voucher = await db.voucher.findFirst({
            where: { tenant_id: tenantId, source_id: belowCost.entityId },
            include: { details: true },
        });
        expect(voucher).not.toBeNull();
        const debits = voucher!.details.reduce((sum, line) => sum + Number(line.debit_amount), 0);
        const credits = voucher!.details.reduce((sum, line) => sum + Number(line.credit_amount), 0);
        expect(Math.abs(debits - credits)).toBeLessThan(0.01);
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
