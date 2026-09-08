/**
 * State shared across every writer in a demo-data run.
 *
 * The simulator commits one transaction per simulated day, so anything that has
 * to survive between days — on-hand stock mirrors, party dues, document-number
 * counters, the anomaly answer key — cannot live inside a writer's local scope.
 * It lives here, and each domain writer takes the world rather than owning a
 * private copy of it.
 */

import { AnomalyPlan, AnomalyRecorder, NO_ANOMALIES } from './anomalies';
import { emptyCounts, type DemoCounts } from './counts';
import type { DemoDataOptions, DemoModuleGroup } from './options';
import { moduleEnabled } from './options';
import type { Rng } from './rng';

export interface ProductRuntime {
    id: string;
    sku: string;
    name: string;
    sellPrice: number;
    cost: number;
    reorderLevel: number;
    popularityWeight: number;
    supplierIndex: number;
    /** Mirrors Product.warranty_enabled — only these can carry a warranty claim. */
    warranty: boolean;
    /** In-memory on-hand mirror of DB ProductStock, keyed by warehouseId. */
    stock: Map<string, number>;
}

export interface PartyRuntime {
    id: string;
    name: string;
    due: number;
}

export interface CustomerRuntime extends PartyRuntime {
    /** Mirrors Customer.credit_limit, so a breach can be planted deliberately. */
    creditLimit: number;
    loyaltyPoints: number;
}

export interface StoreRuntime {
    storeId: string;
    warehouseId: string;
    isMain: boolean;
}

/** A sale kept around so later writers can hang follow-on documents off it. */
export interface RecentSale {
    saleId: string;
    serial: string;
    total: number;
    storeId: string;
    warehouseId: string;
    /** Index into `customers`; -1 for a walk-in. */
    customerIndex: number;
    date: Date;
    productIds: string[];
}

export interface EmployeeRuntime {
    id: string;
    name: string;
    /** Monthly basic salary in BDT. */
    salary: number;
    departmentName: string;
    designationName: string;
}

export interface DemoWorldDeps {
    tenantId: string;
    userId: string;
    businessType: string | null | undefined;
    batchNumber: number;
    stores: StoreRuntime[];
    rng: Rng;
    start: Date;
    end: Date;
    options: DemoDataOptions;
    plan?: AnomalyPlan;
}

export class DemoWorld {
    readonly tenantId: string;
    readonly userId: string;
    readonly businessType: string | null | undefined;
    readonly batchNumber: number;
    readonly stores: StoreRuntime[];
    readonly rng: Rng;
    readonly start: Date;
    readonly end: Date;
    readonly options: DemoDataOptions;
    readonly plan: AnomalyPlan;

    readonly counts: DemoCounts = emptyCounts();
    readonly anomalies = new AnomalyRecorder();

    products: ProductRuntime[] = [];
    customers: CustomerRuntime[] = [];
    suppliers: PartyRuntime[] = [];
    employees: EmployeeRuntime[] = [];
    expenseCategoryIds = new Map<string, string>();

    /**
     * A short tail of the most recent sales. Deliveries, warranty claims and
     * loyalty points all attach to a sale that already happened, and they run
     * after the core writer inside the same day, so they need somewhere to look
     * it up. Capped — this is a window, not a log.
     */
    private readonly recentSales: RecentSale[] = [];

    /** Per-prefix document-number counters, namespaced by batch in `ref()`. */
    private readonly seq = new Map<string, number>();

    constructor(deps: DemoWorldDeps) {
        this.tenantId = deps.tenantId;
        this.userId = deps.userId;
        this.businessType = deps.businessType;
        this.batchNumber = deps.batchNumber;
        this.stores = deps.stores;
        this.rng = deps.rng;
        this.start = deps.start;
        this.end = deps.end;
        this.options = deps.options;
        this.plan = deps.options.includeAnomalies ? (deps.plan ?? NO_ANOMALIES) : NO_ANOMALIES;
    }

    get mainStore(): StoreRuntime {
        return this.stores.find((s) => s.isMain) ?? this.stores[0];
    }

    get secondStore(): StoreRuntime | undefined {
        return this.stores.find((s) => !s.isMain);
    }

    /**
     * The next document number for `prefix`, namespaced by batch number so an
     * appended batch never collides with an earlier one or with a real reference.
     */
    ref(prefix: string): string {
        const next = (this.seq.get(prefix) ?? 0) + 1;
        this.seq.set(prefix, next);
        return `D${this.batchNumber}-${prefix}${String(next).padStart(5, '0')}`;
    }

    recordSaleForFollowUp(sale: RecentSale): void {
        this.recentSales.push(sale);
        if (this.recentSales.length > 80) this.recentSales.shift();
    }

    /** The most recent sales, newest last. */
    get recent(): readonly RecentSale[] {
        return this.recentSales;
    }

    enabled(group: DemoModuleGroup): boolean {
        return moduleEnabled(this.options, group);
    }

    /** Clamp a generated timestamp so nothing lands in the future. */
    clampToWindow(date: Date): Date {
        return new Date(Math.min(date.getTime(), this.end.getTime()));
    }
}
