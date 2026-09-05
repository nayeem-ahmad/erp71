import {
    EXPRESS_RETAIL_PROVIDER,
    ExpressRetailClient,
    ExpressRetailSale,
    ExpressRetailSaleLine,
    ExpressRetailPurchase,
    ExpressRetailPurchaseLine,
} from './express-retail.client';
import {
    DIZI_CASHIER_PROVIDER,
    DIZI_CASHIER_DEFAULT_BASE_URL,
    DiziCashierClient,
    DiziPurchaseHeader,
    DiziSaleHeader,
} from './dizi-cashier.client';
import {
    DateWindow,
    MappedCustomer,
    MappedPayment,
    MappedProduct,
    MappedPurchase,
    MappedSale,
    MappedSaleReturn,
    MappedSupplier,
    PaymentParty,
    SyncWarning,
    groupBy,
    mapCustomer,
    mapPayment,
    mapProduct,
    mapPurchase,
    mapSale,
    mapSaleReturn,
    mapSupplier,
    splitIntoMonthlyWindows,
} from './external-sync.mapper';
import {
    mapDiziCustomer,
    mapDiziPayment,
    mapDiziProduct,
    mapDiziPurchase,
    mapDiziSale,
    mapDiziSaleReturn,
    mapDiziSupplier,
} from './dizi-cashier.mapper';

/**
 * A provider is two collaborating halves that always travel together: a
 * {@link ProviderClient} that fetches raw rows and assembles them into
 * per-document payloads, and a {@link ProviderMappers} bundle that turns those
 * rows/payloads into the provider-agnostic `Mapped*` shapes the service
 * persists.
 *
 * The service is the orchestrator: it owns dedupe, adoption, impacts and the
 * mapping table, and reaches a provider only through these two interfaces. That
 * is what lets a second provider (Dizi Cashier) be added without touching the
 * import logic — see external-sync.service.ts. Express Retail Pro is the
 * default so the pre-existing single-provider call sites keep working unchanged.
 */

export interface ProviderSession {
    organizationId: string;
    user: { name: string; username: string; role: string };
}

/**
 * Raw fetch + per-document assembly. Every method returns provider-specific
 * shapes; the matching {@link ProviderMappers} in the same {@link ProviderDefinition}
 * is the only code that reads them, so they are typed loosely here on purpose.
 */
export interface ProviderClient {
    login(): Promise<ProviderSession>;
    fetchProducts(): Promise<unknown[]>;
    fetchCustomers(): Promise<unknown[]>;
    fetchSuppliers(): Promise<unknown[]>;
    /** Sale headers paired with everything the sale mapper needs (lines/detail). */
    fetchSaleDocuments(window: DateWindow): Promise<unknown[]>;
    fetchPurchaseDocuments(window: DateWindow): Promise<unknown[]>;
    fetchPayments(window: DateWindow, party: PaymentParty): Promise<unknown[]>;
    fetchSaleReturnDocuments(window: DateWindow): Promise<unknown[]>;
}

export interface ProviderMappers {
    product(row: any, claimedSkus: Set<string>): MappedProduct;
    customer(row: any, claimedCodes: Set<string>): MappedCustomer;
    supplier(row: any, claimedNames: Set<string>): MappedSupplier;
    sale(doc: any, documentPrefix: string, warnings: SyncWarning[]): MappedSale;
    purchase(doc: any, documentPrefix: string, warnings: SyncWarning[]): MappedPurchase;
    payment(row: any, party: PaymentParty, documentPrefix: string, warnings: SyncWarning[]): MappedPayment | null;
    saleReturn(doc: any, documentPrefix: string, warnings: SyncWarning[]): MappedSaleReturn;
}

export interface ProviderDefinition {
    provider: string;
    /** Human label for the admin/tenant UI. */
    label: string;
    /** Prefilled base URL for a new connection form. */
    defaultBaseUrl: string;
    /** Prefix stamped on imported document numbers so they cannot collide. */
    defaultDocumentPrefix: string;
    /** How the run is chunked. Windowed providers split; paginated ones do not. */
    planWindows(from: Date, to: Date): DateWindow[];
    createClient(credentials: { baseUrl: string; username: string; password: string }): ProviderClient;
    mappers: ProviderMappers;
}

/** Runs `fn` over `items` with a bounded number in flight, preserving order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await fn(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

/** Inclusive date-window test on a `YYYY-MM-DD...` timestamp. */
function inWindow(value: string | null | undefined, window: DateWindow): boolean {
    if (!value) return false;
    const day = value.slice(0, 10);
    return day >= window.from && day <= window.to;
}

// ------------------------------------------------------------ Express Retail

const EXPRESS_MAPPERS: ProviderMappers = {
    product: mapProduct,
    customer: mapCustomer,
    supplier: mapSupplier,
    sale: (doc: { header: ExpressRetailSale; lines: ExpressRetailSaleLine[] }, prefix, warnings) =>
        mapSale(doc.header, doc.lines, prefix, warnings),
    purchase: (doc: { header: ExpressRetailPurchase; lines: ExpressRetailPurchaseLine[] }, prefix, warnings) =>
        mapPurchase(doc.header, doc.lines, prefix, warnings),
    payment: mapPayment,
    saleReturn: (doc, prefix, warnings) => mapSaleReturn(doc, prefix, warnings),
};

class ExpressProviderClient implements ProviderClient {
    constructor(private readonly inner: ExpressRetailClient) {}

    async login(): Promise<ProviderSession> {
        const s = await this.inner.login();
        return { organizationId: s.organizationId, user: { name: s.name, username: s.username, role: s.role } };
    }

    fetchProducts() {
        return this.inner.fetchProducts();
    }
    fetchCustomers() {
        return this.inner.fetchCustomers();
    }
    fetchSuppliers() {
        return this.inner.fetchSuppliers();
    }

    async fetchSaleDocuments(window: DateWindow) {
        const [headers, lines] = await Promise.all([this.inner.fetchSales(window), this.inner.fetchSaleLines(window)]);
        const byId = groupBy(lines, (line) => String(line.sale_id));
        return headers.map((header) => ({ header, lines: byId.get(String(header.id)) ?? [] }));
    }

    async fetchPurchaseDocuments(window: DateWindow) {
        const [headers, lines] = await Promise.all([
            this.inner.fetchPurchases(window),
            this.inner.fetchPurchaseLines(window),
        ]);
        const byId = groupBy(lines, (line) => String(line.purchase_id));
        return headers.map((header) => ({ header, lines: byId.get(String(header.id)) ?? [] }));
    }

    fetchPayments(window: DateWindow, party: PaymentParty) {
        return party === 'CUSTOMER'
            ? this.inner.fetchCustomerPayments(window)
            : this.inner.fetchSupplierPayments(window);
    }

    fetchSaleReturnDocuments(window: DateWindow) {
        return this.inner.fetchSaleReturns(window);
    }
}

export const EXPRESS_RETAIL_DEFINITION: ProviderDefinition = {
    provider: EXPRESS_RETAIL_PROVIDER,
    label: 'Express Retail Pro',
    defaultBaseUrl: 'https://www.expressretailerp.com',
    defaultDocumentPrefix: 'XR-',
    planWindows: (from, to) => splitIntoMonthlyWindows(from, to),
    createClient: (credentials) => new ExpressProviderClient(new ExpressRetailClient(credentials)),
    mappers: EXPRESS_MAPPERS,
};

// -------------------------------------------------------------- Dizi Cashier

/** Detail calls run in a small pool so a big migration does not open hundreds of sockets. */
const DIZI_DETAIL_CONCURRENCY = 8;

const DIZI_MAPPERS: ProviderMappers = {
    product: mapDiziProduct,
    customer: mapDiziCustomer,
    supplier: mapDiziSupplier,
    sale: (doc, prefix, warnings) => mapDiziSale(doc.header, doc.detail, prefix, warnings),
    purchase: (doc, prefix, warnings) => mapDiziPurchase(doc.header, doc.detail, prefix, warnings),
    payment: mapDiziPayment,
    saleReturn: (doc, prefix, warnings) => mapDiziSaleReturn(doc, prefix, warnings),
};

class DiziProviderClient implements ProviderClient {
    constructor(private readonly inner: DiziCashierClient) {}

    async login(): Promise<ProviderSession> {
        const s = await this.inner.login();
        // Dizi has no per-user role in the login payload; owner is the closest signal.
        return {
            organizationId: s.organizationId,
            user: { name: s.fullName, username: s.userName, role: s.isOwner ? 'OWNER' : 'USER' },
        };
    }

    fetchProducts() {
        return this.inner.fetchProducts();
    }
    fetchCustomers() {
        return this.inner.fetchCustomers();
    }
    fetchSuppliers() {
        return this.inner.fetchSuppliers();
    }

    async fetchSaleDocuments(window: DateWindow) {
        const headers = (await this.inner.fetchSaleHeaders()).filter(
            (h: DiziSaleHeader) => !h.IsDeleted && inWindow(h.TransactionDate, window),
        );
        const details = await mapWithConcurrency(headers, DIZI_DETAIL_CONCURRENCY, (h) =>
            this.inner.fetchSaleDetail(h.Id).catch(() => null),
        );
        return headers.map((header, i) => ({ header, detail: details[i] }));
    }

    async fetchPurchaseDocuments(window: DateWindow) {
        const headers = (await this.inner.fetchPurchaseHeaders()).filter(
            (h: DiziPurchaseHeader) => !h.IsDeleted && inWindow(h.TransactionDate, window),
        );
        const details = await mapWithConcurrency(headers, DIZI_DETAIL_CONCURRENCY, (h) =>
            this.inner.fetchPurchaseDetail(h.Id).catch(() => null),
        );
        return headers.map((header, i) => ({ header, detail: details[i] }));
    }

    async fetchPayments(window: DateWindow, party: PaymentParty) {
        const rows =
            party === 'CUSTOMER' ? await this.inner.fetchCustomerPayments() : await this.inner.fetchSupplierPayments();
        return rows.filter((r) => !r.IsDeleted && inWindow(r.Date, window));
    }

    async fetchSaleReturnDocuments(window: DateWindow) {
        const headers = (await this.inner.fetchSaleReturnHeaders()).filter((h) => inWindow(h.ReturnDate, window));
        // The parent-sale link and line items live only on the detail payload.
        const details = await mapWithConcurrency(headers, DIZI_DETAIL_CONCURRENCY, (h) =>
            this.inner.fetchSaleReturnDetail(h.Id),
        );
        return details;
    }
}

export const DIZI_CASHIER_DEFINITION: ProviderDefinition = {
    provider: DIZI_CASHIER_PROVIDER,
    label: 'Dizi Cashier',
    defaultBaseUrl: DIZI_CASHIER_DEFAULT_BASE_URL,
    defaultDocumentPrefix: 'DZ-',
    // Dizi paginates rather than filtering by date, so the whole range is one
    // window; the client walks every page and filters client-side.
    planWindows: (from, to) => [{ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }],
    createClient: (credentials) => new DiziProviderClient(new DiziCashierClient(credentials)),
    mappers: DIZI_MAPPERS,
};

// ----------------------------------------------------------------- registry

const DEFINITIONS: ProviderDefinition[] = [EXPRESS_RETAIL_DEFINITION, DIZI_CASHIER_DEFINITION];

const BY_KEY = new Map(DEFINITIONS.map((d) => [d.provider, d]));

/** The provider a request defaults to when none is named — keeps old callers working. */
export const DEFAULT_PROVIDER = EXPRESS_RETAIL_PROVIDER;

export function listProviderDefinitions(): ProviderDefinition[] {
    return DEFINITIONS;
}

export function getProviderDefinition(provider: string | null | undefined): ProviderDefinition {
    const def = BY_KEY.get(provider ?? DEFAULT_PROVIDER);
    if (!def) {
        throw new Error(`Unknown external-sync provider: ${provider}`);
    }
    return def;
}

export function isKnownProvider(provider: string): boolean {
    return BY_KEY.has(provider);
}

export { EXPRESS_MAPPERS };
