import { Prisma, PrismaClient } from '@prisma/client';
import { ensureDefaultWarehouse } from '../../database/inventory.utils';
import { type AnomalyKind, type DemoAnomaly, planAnomalies } from './anomalies';
import { DemoWorld, type StoreRuntime } from './context';
import type { DemoCounts } from './counts';
import { DEFAULT_DEMO_OPTIONS, type DemoDataOptions } from './options';
import { Rng } from './rng';
import { DemoWriter } from './write';
import { CrmWriter } from './write-crm';
import { FinanceWriter } from './write-finance';
import { HrWriter } from './write-hr';
import { OpsWriter } from './write-ops';
import { PipelineWriter } from './write-pipeline';

const DAY_MS = 24 * 60 * 60 * 1000;
const TX_OPTIONS = { timeout: 180_000, maxWait: 180_000 };

/** ~15 sales/day baseline before weekday/growth/noise modifiers. */
const BASE_DAILY_SALES = 13;
const CUSTOMER_COUNT = 60;
const SUPPLIER_COUNT = 12;
const CRM_CONTACT_COUNT = 24;

/** Sale-shaped anomalies: handled by writing one extra, deliberately odd sale. */
const SALE_ANOMALIES: readonly AnomalyKind[] = [
    'BELOW_COST_SALE', 'DEEP_DISCOUNT_SALE', 'AFTER_HOURS_SALE',
    'ROUND_NUMBER_CASH_SPIKE', 'CREDIT_LIMIT_BREACH', 'RAPID_FULL_RETURN', 'STALE_CREDIT_DEBT',
];

export interface SimulationProgress {
    phase: string;
    processed: number;
    total: number;
    counts: DemoCounts;
}

export interface SimulationResult {
    counts: DemoCounts;
    anomalies: DemoAnomaly[];
    options: DemoDataOptions;
}

export interface SimulationDeps {
    db: PrismaClient;
    tenantId: string;
    userId: string;
    batchNumber: number;
    /** What the operator asked for. Defaults to the full six-month dataset. */
    options?: DemoDataOptions;
    /** Overridable for deterministic tests; defaults to now. */
    now?: Date;
    /**
     * Shortens the simulated window (tests use a few weeks instead of six months
     * to keep the integration run fast). Overrides `options.months`.
     */
    windowDays?: number;
    onProgress?: (p: SimulationProgress) => Promise<void> | void;
}

/** Bangladesh weekend is Friday–Saturday; Sunday starts the work week slow. */
function weekdayFactor(day: number): number {
    if (day === 5 || day === 6) return 1.3; // Fri, Sat
    if (day === 0) return 0.95; // Sun
    return 1;
}

async function resolveStores(db: PrismaClient, tenantId: string): Promise<StoreRuntime[]> {
    const stores = await db.store.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'asc' },
        take: 2,
    });
    if (stores.length === 0) throw new Error('No store found for this tenant');

    const runtime: StoreRuntime[] = [];
    for (const [index, store] of stores.entries()) {
        const warehouse = await ensureDefaultWarehouse(db, tenantId, store.id);
        runtime.push({ storeId: store.id, warehouseId: warehouse.id, isMain: index === 0 });
    }
    return runtime;
}

/**
 * Run the demo simulation for one tenant/batch. Each simulated day commits in
 * its own transaction so we never hold locks for minutes; progress is reported
 * between days. Returns the aggregate counts, the anomalies planted, and the
 * options the batch actually ran with.
 *
 * Module groups outside `core` can be switched off per batch — that is what
 * makes a second load useful rather than a duplicate of the first.
 */
export async function runSimulation(deps: SimulationDeps): Promise<SimulationResult> {
    const { db, tenantId, userId, batchNumber } = deps;
    const options = deps.options ?? { ...DEFAULT_DEMO_OPTIONS, modules: [...DEFAULT_DEMO_OPTIONS.modules] };

    const end = deps.now ?? new Date();
    const start = new Date(end);
    if (deps.windowDays) {
        start.setDate(start.getDate() - deps.windowDays);
    } else {
        start.setMonth(start.getMonth() - options.months);
    }
    const startMidnight = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const totalDays = Math.max(1, Math.round((end.getTime() - startMidnight.getTime()) / DAY_MS));

    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { business_type: true } });
    const stores = await resolveStores(db, tenantId);
    const rng = Rng.forTenant(tenantId, batchNumber);

    const world = new DemoWorld({
        tenantId, userId, businessType: tenant?.business_type, batchNumber, stores, rng,
        start: startMidnight, end, options,
        plan: options.includeAnomalies ? planAnomalies(rng, totalDays) : undefined,
    });

    const writer = new DemoWriter(world);
    const pipeline = new PipelineWriter(world, writer);
    const crm = new CrmWriter(world);
    const hr = new HrWriter(world);
    const finance = new FinanceWriter(world);
    const ops = new OpsWriter(world);

    const report = async (phase: string, processed: number) => {
        if (deps.onProgress) await deps.onProgress({ phase, processed, total: totalDays, counts: world.counts });
    };

    // ── Setup ────────────────────────────────────────────────────────
    await report('Preparing catalog', 0);
    await db.$transaction(async (txRaw) => {
        const tx = txRaw as Prisma.TransactionClient;
        await writer.ensureCatalog(tx);
        await writer.ensureParties(tx, CUSTOMER_COUNT, SUPPLIER_COUNT);
        await writer.loadShrinkageReasons(tx);
    }, TX_OPTIONS);

    if (world.enabled('crm')) {
        await report('Preparing customer groups, price lists and CRM', 0);
        await db.$transaction(async (txRaw) => {
            const tx = txRaw as Prisma.TransactionClient;
            await crm.ensureMasterData(tx);
            await crm.writeContacts(tx, CRM_CONTACT_COUNT);
        }, TX_OPTIONS);
    }

    if (world.enabled('hr')) {
        await report('Hiring staff and setting up payroll', 0);
        await db.$transaction(async (txRaw) => {
            await hr.ensureMasterData(txRaw as Prisma.TransactionClient);
        }, TX_OPTIONS);
    }

    await report('Opening stock', 0);
    await db.$transaction(async (txRaw) => {
        await writer.openingPurchases(txRaw as Prisma.TransactionClient, startMidnight);
    }, TX_OPTIONS);

    if (world.enabled('finance')) {
        await report('Assets, loans and investors', 0);
        await db.$transaction(async (txRaw) => {
            const tx = txRaw as Prisma.TransactionClient;
            await finance.ensureAccountingScaffolding(tx);
            await finance.acquireAssets(tx, startMidnight);
            await finance.openLoans(tx, startMidnight);
            await finance.openInvestors(tx, startMidnight);
        }, TX_OPTIONS);
    }

    if (world.enabled('operations')) {
        await report('Recipes and projects', 0);
        await db.$transaction(async (txRaw) => {
            const tx = txRaw as Prisma.TransactionClient;
            await ops.ensureBom(tx, startMidnight);
            await ops.writeProjects(tx, startMidnight);
            await ops.writeSupportThreads(tx, startMidnight);
        }, TX_OPTIONS);
    }

    // ── Day loop ─────────────────────────────────────────────────────
    for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
        const dayStart = new Date(startMidnight.getTime() + dayIndex * DAY_MS);
        const epochDay = Math.floor(dayStart.getTime() / DAY_MS);
        const weekday = dayStart.getUTCDay();
        const dayOfMonth = dayStart.getUTCDate();
        const month = dayStart.getUTCMonth() + 1;
        const year = dayStart.getUTCFullYear();
        const growth = 1 + 0.3 * (dayIndex / totalDays);
        const dailySales = Math.max(0, Math.round(BASE_DAILY_SALES * weekdayFactor(weekday) * growth * rng.noise(0.35)));
        const todaysAnomalies = world.plan.forDay(dayIndex);
        const tradingTime = (hour: number) =>
            world.clampToWindow(new Date(dayStart.getTime() + hour * 3_600_000));

        await db.$transaction(async (txRaw) => {
            const tx = txRaw as Prisma.TransactionClient;

            await writer.settleDueCredits(tx, dayStart, epochDay);
            await writer.paySuppliers(tx, dayStart);

            for (let s = 0; s < dailySales; s++) {
                const store = rng.chance(0.7) ? stores[0] : (stores[1] ?? stores[0]);
                const hour = rng.int(10, 20);
                // Clamp to `end` so a sale on the current day is never stamped past
                // `now` (the 10–20h spread would otherwise put today's late sales in
                // the future when the run happens before 20:00 UTC).
                const saleTime = tradingTime(hour);
                const sale = await writer.writeSale(tx, saleTime, store, growth);
                if (sale && world.enabled('sales')) {
                    await pipeline.writeLoyalty(tx, saleTime, sale.saleId, sale.customerIndex, sale.total);
                }
            }

            // ── Planted anomalies ────────────────────────────────────
            for (const kind of todaysAnomalies) {
                const store = rng.chance(0.7) ? stores[0] : (stores[1] ?? stores[0]);
                if (SALE_ANOMALIES.includes(kind)) {
                    const at = kind === 'AFTER_HOURS_SALE' ? tradingTime(3) : tradingTime(rng.int(10, 20));
                    const customerIndex = kind === 'CREDIT_LIMIT_BREACH' || kind === 'STALE_CREDIT_DEBT'
                        ? rng.int(0, world.customers.length - 1)
                        : undefined;
                    await writer.writeSale(tx, at, store, growth, { anomaly: kind, customerIndex });
                    continue;
                }
                switch (kind) {
                    case 'DUPLICATE_INVOICE':
                        await writer.writeDuplicateInvoice(tx, tradingTime(rng.int(11, 18)), store, growth);
                        break;
                    case 'SUPPLIER_PRICE_SPIKE':
                        await writer.writeSupplierPriceSpike(tx, tradingTime(9), world.mainStore);
                        break;
                    case 'DUPLICATE_SUPPLIER_BILL':
                        await writer.writeDuplicateSupplierBill(tx, tradingTime(9), world.mainStore);
                        break;
                    case 'SUPPLIER_OVERPAYMENT':
                        await writer.paySuppliers(tx, tradingTime(12), true);
                        break;
                    case 'EXPENSE_SPIKE':
                        await writer.writeExpenseSpike(tx, tradingTime(14));
                        break;
                    case 'LARGE_SHRINKAGE':
                        await writer.maybeShrinkage(tx, tradingTime(16), true);
                        break;
                    case 'ROUND_TRIP_TRANSFER':
                        await writer.maybeTransfer(tx, tradingTime(11), true);
                        break;
                    case 'STOCK_TAKE_VARIANCE':
                        await writer.writeStockTake(tx, tradingTime(19), world.mainStore, true);
                        break;
                    default:
                        break;
                }
            }

            await writer.maybeSalesReturn(tx, dayStart, epochDay);
            await writer.maybePurchaseReturn(tx, dayStart, epochDay);
            await writer.maybeTransfer(tx, dayStart);
            await writer.maybeShrinkage(tx, dayStart);

            // Expenses: rent/utilities monthly, transport weekly. Wages are only
            // booked here when payroll is not part of this batch — otherwise the
            // salary accrual would double-count them.
            if (dayOfMonth === 1) {
                await writer.writeExpense(tx, dayStart, 'Shop Rent', 25000, true);
                await writer.writeExpense(tx, dayStart, 'Utilities', rng.int(4000, 8000), true);
                if (!world.enabled('hr')) {
                    await writer.writeExpense(tx, dayStart, 'Salaries', rng.int(40000, 60000), true);
                }
            }
            if (dayIndex % 7 === 0) {
                await writer.writeExpense(tx, dayStart, 'Transport', rng.int(800, 2500), false);
            }
            if (rng.chance(0.05)) {
                await writer.writeExpense(tx, dayStart, 'Miscellaneous', rng.int(500, 3000), false);
            }

            // Quarterly stock take on the main store.
            if (dayIndex > 0 && dayIndex % 90 === 0) {
                await writer.writeStockTake(tx, dayStart, stores[0]);
            }

            // A cashier session per store per trading day; one of them is short
            // when the day carries the drawer-shortage anomaly.
            if (dailySales > 0) {
                const shortStore = todaysAnomalies.includes('CASH_DRAWER_SHORTAGE') ? rng.pick(stores) : null;
                for (const store of stores) {
                    await writer.writeCashierSession(tx, dayStart, store, store === shortStore);
                }
            }

            // ── Sales and purchasing pipeline ────────────────────────
            if (world.enabled('sales')) {
                if (rng.chance(0.5)) {
                    const quotation = await pipeline.writeQuotation(tx, tradingTime(12), world.mainStore);
                    if (quotation?.accepted) {
                        await pipeline.writeSalesOrder(tx, tradingTime(15), world.mainStore, quotation.id);
                    }
                }
                if (rng.chance(0.3)) await pipeline.writeSalesOrder(tx, tradingTime(14), world.mainStore);
                await pipeline.maybeDeliveryOrder(tx, tradingTime(17));
                await pipeline.maybeStorefrontOrder(tx, tradingTime(21));
                await pipeline.maybeWarrantyClaim(tx, tradingTime(13));
                await pipeline.flushLoyalty(tx, tradingTime(20));
            }

            if (world.enabled('purchasing')) {
                if (rng.chance(0.2)) await pipeline.writePurchaseQuotation(tx, tradingTime(10));
                if (rng.chance(0.22)) await pipeline.writePurchaseOrder(tx, tradingTime(11));
                if (rng.chance(0.18)) await pipeline.writeProductDemand(tx, tradingTime(9));
            }

            // ── CRM ──────────────────────────────────────────────────
            if (world.enabled('crm')) {
                const leadsToday = rng.weighted([0, 1, 2, 3], [25, 40, 25, 10]);
                for (let i = 0; i < leadsToday; i++) {
                    await crm.writeLead(tx, tradingTime(rng.int(10, 19)), dayIndex, totalDays);
                }
                await crm.maybeInteraction(tx, tradingTime(rng.int(10, 19)));
                await crm.maybeActivity(tx, tradingTime(rng.int(10, 19)));
                await crm.maybeFollowUp(tx, tradingTime(rng.int(10, 19)));
                if (dayOfMonth === 5) await crm.writeCampaign(tx, tradingTime(11));
            }

            // ── HR ───────────────────────────────────────────────────
            if (world.enabled('hr')) {
                await hr.writeAttendance(tx, dayStart);
                await hr.maybeLeaveRequest(tx, tradingTime(12));
                await hr.maybeExpenseClaim(tx, tradingTime(16));
                // Close off the previous month on the 1st: accrue, then settle.
                if (dayOfMonth === 1 && dayIndex > 0) {
                    const previous = new Date(Date.UTC(year, month - 2, 1));
                    const payPeriod = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
                    await hr.runPayroll(tx, tradingTime(10), payPeriod);
                }
            }

            // ── Finance ──────────────────────────────────────────────
            if (world.enabled('finance')) {
                if (dayOfMonth === 28) {
                    await finance.runDepreciation(tx, tradingTime(18), year, month);
                    await finance.repayLoans(tx, tradingTime(18));
                }
                if (dayOfMonth === 10 || dayOfMonth === 24) {
                    await finance.writeFundTransfer(tx, tradingTime(17));
                }
                if (dayOfMonth === 15) {
                    await finance.maybeCapitalMovement(tx, tradingTime(13));
                }
                if (dayOfMonth === 2 && month % 3 === 1) {
                    const previous = new Date(Date.UTC(year, month - 2, 1));
                    await finance.runProfitDistribution(
                        tx, tradingTime(12), previous.getUTCFullYear(), previous.getUTCMonth() + 1,
                    );
                }
            }

            // ── Operations ───────────────────────────────────────────
            if (world.enabled('operations') && dayIndex % 7 === 3) {
                await ops.runProductionJob(tx, tradingTime(11));
            }
        }, TX_OPTIONS);

        if (dayIndex % 5 === 0 || dayIndex === totalDays - 1) {
            await report(`Simulating day ${dayIndex + 1} of ${totalDays}`, dayIndex + 1);
        }
    }

    // Low-stock alerts reflect where stock actually ended up, so they are written
    // once at the end rather than against a mid-run snapshot.
    if (world.enabled('operations')) {
        await report('Raising alerts', totalDays);
        await db.$transaction(async (txRaw) => {
            await ops.writeNotifications(txRaw as Prisma.TransactionClient, end);
        }, TX_OPTIONS);
    }

    await report('Completed', totalDays);
    return { counts: world.counts, anomalies: world.anomalies.list(), options };
}
