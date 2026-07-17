import { Prisma, PrismaClient } from '@prisma/client';
import { ensureCustomerPaymentPostingSetup } from '@erp71/database';
import { ensureDefaultWarehouse } from '../../database/inventory.utils';
import { Rng } from './rng';
import { DemoWriter, type DemoCounts } from './write';

const DAY_MS = 24 * 60 * 60 * 1000;
const TX_OPTIONS = { timeout: 120_000, maxWait: 120_000 };

/** ~15 sales/day baseline before weekday/growth/noise modifiers. */
const BASE_DAILY_SALES = 13;
const CUSTOMER_COUNT = 60;
const SUPPLIER_COUNT = 12;

export interface SimulationProgress {
    phase: string;
    processed: number;
    total: number;
    counts: DemoCounts;
}

export interface SimulationDeps {
    db: PrismaClient;
    tenantId: string;
    userId: string;
    batchNumber: number;
    /** Overridable for deterministic tests; defaults to now. */
    now?: Date;
    /**
     * Shortens the simulated window (tests use a few weeks instead of six months
     * to keep the integration run fast). Defaults to a full six months.
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

interface StoreRuntime {
    storeId: string;
    warehouseId: string;
    isMain: boolean;
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
 * Run the six-month simulation for one tenant/batch. Each simulated day commits
 * in its own transaction so we never hold locks for minutes; progress is reported
 * between days. Returns the aggregate counts of what was generated.
 */
export async function runSimulation(deps: SimulationDeps): Promise<DemoCounts> {
    const { db, tenantId, userId, batchNumber } = deps;

    const end = deps.now ?? new Date();
    const start = new Date(end);
    if (deps.windowDays) {
        start.setDate(start.getDate() - deps.windowDays);
    } else {
        start.setMonth(start.getMonth() - 6);
    }
    const startMidnight = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const totalDays = Math.max(1, Math.round((end.getTime() - startMidnight.getTime()) / DAY_MS));

    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { business_type: true } });
    const stores = await resolveStores(db, tenantId);
    const rng = Rng.forTenant(tenantId, batchNumber);

    const writer = new DemoWriter({
        tenantId, userId, businessType: tenant?.business_type, batchNumber, stores, rng, start: startMidnight, end,
    });

    const report = async (phase: string, processed: number) => {
        if (deps.onProgress) await deps.onProgress({ phase, processed, total: totalDays, counts: writer.counts });
    };

    // ── Setup ────────────────────────────────────────────────────────
    await report('Preparing catalog', 0);
    await db.$transaction(async (tx) => {
        await writer.ensureCatalog(tx as Prisma.TransactionClient);
        await writer.ensureParties(tx as Prisma.TransactionClient, CUSTOMER_COUNT, SUPPLIER_COUNT);
        await writer.loadShrinkageReasons(tx as Prisma.TransactionClient);
        await ensureCustomerPaymentPostingSetup(tx, tenantId);
    }, TX_OPTIONS);

    await report('Opening stock', 0);
    await db.$transaction(async (tx) => {
        await writer.openingPurchases(tx as Prisma.TransactionClient, startMidnight);
    }, TX_OPTIONS);

    // ── Day loop ─────────────────────────────────────────────────────
    for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
        const dayStart = new Date(startMidnight.getTime() + dayIndex * DAY_MS);
        const epochDay = Math.floor(dayStart.getTime() / DAY_MS);
        const weekday = dayStart.getUTCDay();
        const growth = 1 + 0.3 * (dayIndex / totalDays);
        const dailySales = Math.max(0, Math.round(BASE_DAILY_SALES * weekdayFactor(weekday) * growth * rng.noise(0.35)));

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
                const saleTime = new Date(Math.min(dayStart.getTime() + hour * 3_600_000, end.getTime()));
                await writer.writeSale(tx, saleTime, store, growth);
            }

            await writer.maybeSalesReturn(tx, dayStart, epochDay);
            await writer.maybePurchaseReturn(tx, dayStart, epochDay);
            await writer.maybeTransfer(tx, dayStart);
            await writer.maybeShrinkage(tx, dayStart);

            // Expenses: rent/utilities/salary monthly, transport weekly.
            if (dayStart.getUTCDate() === 1) {
                await writer.writeExpense(tx, dayStart, 'Shop Rent', 25000, true);
                await writer.writeExpense(tx, dayStart, 'Utilities', rng.int(4000, 8000), true);
                await writer.writeExpense(tx, dayStart, 'Salaries', rng.int(40000, 60000), true);
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

            // A cashier session per store per trading day.
            if (dailySales > 0) {
                for (const store of stores) {
                    await writer.writeCashierSession(tx, dayStart, store);
                }
            }
        }, TX_OPTIONS);

        if (dayIndex % 5 === 0 || dayIndex === totalDays - 1) {
            await report(`Simulating day ${dayIndex + 1} of ${totalDays}`, dayIndex + 1);
        }
    }

    await report('Completed', totalDays);
    return writer.counts;
}
