import { BadGatewayException, BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';

/**
 * HTTP client for Express Retail Pro (bigtech.com.bd).
 *
 * The product ships no documented API. It is a Laravel + Vue app whose SPA
 * talks to session-authenticated JSON endpoints, and that is what we drive
 * here. Consequences worth remembering when this breaks:
 *
 *  - Auth is a Laravel session cookie obtained from `POST /login`.
 *  - Every subsequent POST must echo the `XSRF-TOKEN` cookie back as an
 *    `X-XSRF-TOKEN` header, URL-decoded. Laravel rejects it otherwise (419).
 *  - Endpoints filter on the *business date* of the document, not on
 *    created_at/updated_at, and they omit soft-deleted rows entirely.
 *  - There is no pagination; a request returns the whole range at once, so
 *    callers should walk the window in month-sized chunks.
 */

export const EXPRESS_RETAIL_PROVIDER = 'EXPRESS_RETAIL_PRO';

/** Endpoints reject bare hostnames, and we never want to talk plaintext. */
export function assertValidBaseUrl(baseUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        throw new BadRequestException('Base URL must be an absolute URL');
    }
    if (parsed.protocol !== 'https:') {
        throw new BadRequestException('Base URL must use https');
    }
    return parsed.origin;
}

export interface ExpressRetailSale {
    id: number | string;
    invoice: string;
    customer_id: string | null;
    date: string;
    subtotal: string;
    discountAmount: string;
    vatAmount: string;
    transport_cost: string;
    total: string;
    paid: string;
    /** Split of `paid`; lets an imported sale post to the right cash/bank account. */
    cashPaid: string | null;
    bankPaid: string | null;
    bank_account_id: string | null;
    due: string;
    returnAmount: string;
    description: string | null;
    sale_type: string;
    status: string;
    organization_id: string;
    created_at: string;
    updated_at: string | null;
}

export interface ExpressRetailSaleLine {
    id: string;
    sale_id: string;
    product_id: string;
    quantity: string;
    purchase_rate: string;
    unit_price: string;
    organization_id: string;
}

export interface ExpressRetailPurchase {
    id: number | string;
    invoice: string;
    supplier_id: string | null;
    date: string;
    subtotal: string;
    discountAmount: string;
    vatAmount: string;
    transport_cost: string;
    total: string;
    paid: string;
    due: string;
    description: string | null;
    status: string;
    organization_id: string;
    created_at: string;
    updated_at: string | null;
}

export interface ExpressRetailPurchaseLine {
    id: string;
    purchase_id: string;
    product_id: string;
    quantity: string;
    unit_price: string;
    organization_id: string;
}

export interface ExpressRetailProduct {
    id: number | string;
    code: string;
    name: string;
    purchase_rate: string | null;
    sale_rate: string | null;
    vat: string | null;
    reorder: string | null;
    is_service: string | null;
    status: string;
    organization_id: string;
    updated_at: string | null;
}

export interface ExpressRetailCustomer {
    id: number | string;
    code: string;
    name: string;
    owner_name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    credit_limit: string | null;
    organization_id: string;
    updated_at: string | null;
}

export interface ExpressRetailSupplier {
    id: number | string;
    code: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    organization_id: string;
    updated_at: string | null;
}

export interface ExpressRetailSaleReturnLine {
    id: number | string;
    sale_return_id: string;
    product_id: string;
    quantity: string | number | null;
    unit_price: string | number | null;
    amount: string | number | null;
}

/**
 * A row from `/get-sale-return`.
 *
 * Unlike sales and purchases, the line items come back embedded, so there is no
 * second details call. The parent sale is only reachable through the nested
 * `sale` object — the return carries no `sale_id` column of its own.
 */
export interface ExpressRetailSaleReturn {
    id: number | string;
    invoice: string;
    customer_id: string | null;
    date: string;
    amount: string | null;
    description: string | null;
    status: string;
    organization_id: string;
    updated_at: string | null;
    sale: { id: number | string; invoice: string; date: string } | null;
    sale_return_details: ExpressRetailSaleReturnLine[] | null;
}

/**
 * A row from `/get-customer-payments` or `/get-supplier-payments`.
 *
 * `type` is the provider's cash direction — CR is cash received, CP is cash
 * paid — and both lists contain both values, because either party can be
 * refunded. Direction therefore comes from `type`, never from the sign of
 * `amount`, which is always positive.
 */
export interface ExpressRetailPayment {
    id: number | string;
    invoice: string;
    date: string;
    customer_id?: string | null;
    supplier_id?: string | null;
    type: string;
    method: string | null;
    bank_account_id: string | null;
    amount: string | null;
    /** Customer rows only — the party's due before this payment landed. */
    previous_due?: string | null;
    note: string | null;
    status: string;
    organization_id: string;
    updated_at: string | null;
}

export interface ExpressRetailCredentials {
    baseUrl: string;
    username: string;
    password: string;
}

export interface ExpressRetailSession {
    userId: number;
    username: string;
    name: string;
    organizationId: string;
    role: string;
}

interface DateWindow {
    from: string; // YYYY-MM-DD
    to: string; // YYYY-MM-DD
}

const REQUEST_TIMEOUT_MS = 120_000;

/** Page size for the paginated payment endpoints. */
const PAYMENT_PAGE_SIZE = 200;

/** Backstop so a misreported `last_page` cannot spin forever. */
const MAX_PAYMENT_PAGES = 500;

export class ExpressRetailClient {
    private readonly logger = new Logger(ExpressRetailClient.name);
    private readonly origin: string;
    private readonly cookies = new Map<string, string>();
    private session: ExpressRetailSession | null = null;

    constructor(private readonly credentials: ExpressRetailCredentials) {
        this.origin = assertValidBaseUrl(credentials.baseUrl);
    }

    getSession(): ExpressRetailSession | null {
        return this.session;
    }

    /**
     * Authenticates and captures the session + XSRF cookies. Returns the
     * provider-side profile so callers can verify the organization id.
     */
    async login(): Promise<ExpressRetailSession> {
        // Prime the session so Laravel issues XSRF-TOKEN before we POST.
        await this.request('GET', '/', { skipAuthCheck: true });

        const form = new FormData();
        form.append('username', this.credentials.username);
        form.append('password', this.credentials.password);

        const res = await this.request('POST', '/login', { body: form, skipAuthCheck: true });
        const payload = await this.readJson(res, '/login');

        if (res.status === 401 || res.status === 422) {
            throw new UnauthorizedException(
                payload?.message || 'Express Retail Pro rejected the configured credentials',
            );
        }
        if (!res.ok || payload?.status !== true) {
            throw new BadGatewayException(
                `Express Retail Pro login failed (HTTP ${res.status}): ${payload?.message ?? 'unknown error'}`,
            );
        }

        const data = payload.data ?? {};
        this.session = {
            userId: Number(data.id),
            username: String(data.username ?? ''),
            name: String(data.name ?? ''),
            organizationId: String(data.organization_id ?? ''),
            role: String(data.role ?? ''),
        };
        return this.session;
    }

    async fetchSales(window: DateWindow): Promise<ExpressRetailSale[]> {
        const data = await this.postJson('/get-sale', { searchType: '', recordType: 'without', ...this.windowBody(window) });
        return this.expectArray<ExpressRetailSale>(data, 'sales', '/get-sale');
    }

    async fetchSaleLines(window: DateWindow): Promise<ExpressRetailSaleLine[]> {
        const data = await this.postJson('/get-sale-details', {
            searchType: 'quantity',
            recordType: 'without',
            productId: '',
            categoryId: '',
            ...this.windowBody(window),
        });
        return this.expectArray<ExpressRetailSaleLine>(data, 'sales', '/get-sale-details');
    }

    async fetchPurchases(window: DateWindow): Promise<ExpressRetailPurchase[]> {
        const data = await this.postJson('/get-purchase', { searchType: '', recordType: 'without', ...this.windowBody(window) });
        return this.expectArray<ExpressRetailPurchase>(data, 'purchases', '/get-purchase');
    }

    async fetchPurchaseLines(window: DateWindow): Promise<ExpressRetailPurchaseLine[]> {
        const data = await this.postJson('/get-purchase-details', {
            searchType: 'quantity',
            recordType: 'without',
            productId: '',
            categoryId: '',
            ...this.windowBody(window),
        });
        return this.expectArray<ExpressRetailPurchaseLine>(data, 'purchases', '/get-purchase-details');
    }

    async fetchProducts(): Promise<ExpressRetailProduct[]> {
        const data = await this.getJson('/get-product');
        return this.expectArray<ExpressRetailProduct>(data, 'products', '/get-product');
    }

    async fetchCustomers(): Promise<ExpressRetailCustomer[]> {
        const data = await this.postJson('/get-customer', {});
        return this.expectArray<ExpressRetailCustomer>(data, 'customers', '/get-customer');
    }

    async fetchSuppliers(): Promise<ExpressRetailSupplier[]> {
        const data = await this.postJson('/get-supplier', {});
        return this.expectArray<ExpressRetailSupplier>(data, 'suppliers', '/get-supplier');
    }

    async fetchSaleReturns(window: DateWindow): Promise<ExpressRetailSaleReturn[]> {
        const data = await this.postJson('/get-sale-return', {
            searchType: '',
            recordType: 'without',
            ...this.windowBody(window),
        });
        return this.expectArray<ExpressRetailSaleReturn>(data, 'salereturns', '/get-sale-return');
    }

    async fetchCustomerPayments(window: DateWindow): Promise<ExpressRetailPayment[]> {
        return this.fetchPaginated('/get-customer-payments', window);
    }

    async fetchSupplierPayments(window: DateWindow): Promise<ExpressRetailPayment[]> {
        return this.fetchPaginated('/get-supplier-payments', window);
    }

    /**
     * The payment endpoints are the only ones that paginate: they return a
     * Laravel paginator (`data.data` plus `data.last_page`) rather than the
     * plain `data.<key>` array every other endpoint returns, so they have to be
     * walked page by page.
     *
     * They honour the same `dateFrom`/`dateTo` window as the sale and purchase
     * endpoints. Note the provider silently ignores unknown filter names and
     * returns *everything*, so the window params must be spelled exactly.
     */
    private async fetchPaginated(path: string, window: DateWindow): Promise<ExpressRetailPayment[]> {
        const rows: ExpressRetailPayment[] = [];
        let page = 1;
        let lastPage = 1;

        do {
            const query = new URLSearchParams({
                page: String(page),
                per_page: String(PAYMENT_PAGE_SIZE),
                name: '',
                dateFrom: window.from,
                dateTo: window.to,
            });
            const data = await this.getJson(`${path}?${query.toString()}`);

            const pageRows = data?.data;
            if (!Array.isArray(pageRows)) {
                throw new BadGatewayException(
                    `Express Retail Pro ${path} returned no "data.data" array — the upstream response shape changed`,
                );
            }
            rows.push(...(pageRows as ExpressRetailPayment[]));

            const reported = Number(data?.last_page);
            lastPage = Number.isFinite(reported) && reported > 0 ? reported : 1;

            // An empty page means the walk is done even if last_page disagrees,
            // and the hard cap stops a misreported paginator looping forever.
            if (pageRows.length === 0) break;
            page += 1;
        } while (page <= lastPage && page <= MAX_PAYMENT_PAGES);

        return rows;
    }

    private windowBody(window: DateWindow) {
        return { dateFrom: window.from, dateTo: window.to };
    }

    private expectArray<T>(data: any, key: string, endpoint: string): T[] {
        const rows = data?.[key];
        if (!Array.isArray(rows)) {
            throw new BadGatewayException(
                `Express Retail Pro ${endpoint} returned no "${key}" array — the upstream response shape changed`,
            );
        }
        return rows as T[];
    }

    private async postJson(path: string, body: Record<string, unknown>): Promise<any> {
        const res = await this.request('POST', path, {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
        const payload = await this.readJson(res, path);
        if (!res.ok || payload?.status !== true) {
            throw new BadGatewayException(
                `Express Retail Pro ${path} failed (HTTP ${res.status}): ${payload?.message ?? 'unknown error'}`,
            );
        }
        return payload.data;
    }

    private async getJson(path: string): Promise<any> {
        const res = await this.request('GET', path);
        const payload = await this.readJson(res, path);
        if (!res.ok || payload?.status !== true) {
            throw new BadGatewayException(
                `Express Retail Pro ${path} failed (HTTP ${res.status}): ${payload?.message ?? 'unknown error'}`,
            );
        }
        return payload.data;
    }

    private async readJson(res: Response, path: string): Promise<any> {
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            // A login redirect or an HTML error page means the session lapsed.
            if (text.trimStart().startsWith('<')) {
                throw new BadGatewayException(
                    `Express Retail Pro ${path} returned HTML instead of JSON — the session likely expired`,
                );
            }
            throw new BadGatewayException(`Express Retail Pro ${path} returned a non-JSON response`);
        }
    }

    private async request(
        method: 'GET' | 'POST',
        path: string,
        options: { body?: BodyInit; headers?: Record<string, string>; skipAuthCheck?: boolean } = {},
    ): Promise<Response> {
        if (!options.skipAuthCheck && !this.session) {
            throw new UnauthorizedException('Express Retail Pro client is not logged in');
        }

        const headers: Record<string, string> = {
            Accept: 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
            ...options.headers,
        };

        const cookieHeader = this.cookieHeader();
        if (cookieHeader) headers.Cookie = cookieHeader;

        const xsrf = this.cookies.get('XSRF-TOKEN');
        if (xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf);

        let res: Response;
        try {
            res = await fetch(`${this.origin}${path}`, {
                method,
                headers,
                body: options.body,
                redirect: 'manual',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error: any) {
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
                throw new BadGatewayException(
                    `Express Retail Pro ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s — try a shorter date window`,
                );
            }
            throw new BadGatewayException(`Express Retail Pro ${path} is unreachable: ${error?.message ?? error}`);
        }

        this.captureCookies(res);
        return res;
    }

    private captureCookies(res: Response) {
        // undici exposes multiple Set-Cookie headers via getSetCookie().
        const raw: string[] =
            typeof (res.headers as any).getSetCookie === 'function'
                ? (res.headers as any).getSetCookie()
                : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);

        for (const entry of raw) {
            const [pair] = entry.split(';');
            const index = pair.indexOf('=');
            if (index <= 0) continue;
            this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
    }

    private cookieHeader(): string {
        return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    }
}
