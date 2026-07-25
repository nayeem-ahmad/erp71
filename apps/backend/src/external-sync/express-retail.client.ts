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
