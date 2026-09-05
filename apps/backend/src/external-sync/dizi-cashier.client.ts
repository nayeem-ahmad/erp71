import { BadGatewayException, BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import { assertValidBaseUrl } from './express-retail.client';

/**
 * HTTP client for Dizi Cashier (dizicashier.com).
 *
 * Dizi is an ASP.NET + AngularJS app whose SPA (app.dizicashier.com) drives a
 * separate JSON API (api.dizicashier.com). This client talks to that API
 * directly. Consequences worth remembering when this breaks:
 *
 *  - Auth is a bearer token from `POST api/account/login` ({UserName,Password}).
 *    The login response is a *flat* object (access_token, OrganizationId, …),
 *    not the `{Success,Data}` envelope every other endpoint uses. The token
 *    lasts ~24h, comfortably longer than a full history import.
 *  - List endpoints paginate with `page` / `itemsPerPage` and an obligatory
 *    `sort=<Field>-<dir>`; omit the sort and the server defaults to a column
 *    (`CreatedOn`) that does not exist on several tables and 500s. Each list
 *    response is `{Success, Data:{ModelList, TotalItem}}`.
 *  - Sale, purchase and sale-return *line items* are not on the list rows; each
 *    needs a per-document detail GET (`api/sales/{id}` etc.). The importer
 *    fetches those with a bounded concurrency (see the adapter).
 *  - The API base is api.dizicashier.com even though users log in at
 *    app.dizicashier.com; store the API origin as the connection base URL.
 */

export const DIZI_CASHIER_PROVIDER = 'DIZI_CASHIER';

/** api.dizicashier.com is the only host the endpoints below live on. */
export const DIZI_CASHIER_DEFAULT_BASE_URL = 'https://api.dizicashier.com';

/** Rows returned by `api/item`. Only the fields the mapper reads are typed. */
export interface DiziItem {
    Id: string;
    Name: string | null;
    SKU: string | null;
    Barcode: string | null;
    Description: string | null;
    ItemCategoryId: string | null;
    PriceIncludingTax: number | string | null;
    BuyingPriceIncludingTax: number | string | null;
    WeightedAvgCost: number | string | null;
    MinimumStock: number | string | null;
    IsService: boolean | null;
    IsActive: boolean | null;
    IsDeleted: boolean | null;
    UpdatedOn?: string | null;
}

/** Rows returned by `api/trader/customer` and `api/trader/supplier`. */
export interface DiziTrader {
    Id: string;
    Name: string | null;
    Code: string | null;
    ContactNo: string | null;
    ContactPerson: string | null;
    Email: string | null;
    Location: string | null;
    /** The party's *current* net balance (positive = they owe the shop). */
    Balance: number | string | null;
    IsSupplier: boolean | null;
    IsActive: boolean | null;
    IsDeleted: boolean | null;
    UpdatedOn?: string | null;
}

/** A row from the `api/sales/` list. Line items arrive via {@link DiziSaleDetail}. */
export interface DiziSaleHeader {
    Id: string;
    SlipNo: string | null;
    TransactionDate: string;
    TraderId: string | null;
    TotalAmount: number | string | null;
    ReceivedAmount: number | string | null;
    DueAmount: number | string | null;
    IsDeleted: boolean | null;
    IsActive: boolean | null;
    IsServiceSale: boolean | null;
}

export interface DiziSaleItem {
    ItemId: string | null;
    Quantity: number | string | null;
    PricePerUnitWithTax: number | string | null;
    DiscountedPricePerUnitWithTax: number | string | null;
    PricePerUnit: number | string | null;
    CostPrice: number | string | null;
}

export interface DiziSaleDetail {
    Id: string;
    SlipNo: string | null;
    Date: string;
    CustomerId: string | null;
    TotalAmount: number | string | null;
    ReceivedAmount: number | string | null;
    CashOrBankAccount: string | null;
    Narration: string | null;
    UpdatedOn?: string | null;
    SalesItems: DiziSaleItem[] | null;
}

export interface DiziPurchaseHeader {
    Id: string;
    SlipNo: string | null;
    TransactionDate: string;
    TraderId: string | null;
    TotalAmount: number | string | null;
    ReceivedAmount: number | string | null;
    DueAmount: number | string | null;
    IsDeleted: boolean | null;
    IsActive: boolean | null;
}

export interface DiziPurchaseItem {
    ItemId: string | null;
    Quantity: number | string | null;
    PricePerUnit: number | string | null;
    DiscountedPricePerUnit: number | string | null;
    SubTotalAmount: number | string | null;
}

export interface DiziPurchaseDetail {
    Id: string;
    SlipNo: string | null;
    Date: string;
    SupplierId: string | null;
    BasePriceAmount: number | string | null;
    TaxAmount: number | string | null;
    DiscountAmount: number | string | null;
    TotalAmount: number | string | null;
    PaidAmount: number | string | null;
    Narration: string | null;
    UpdatedOn?: string | null;
    PurchaseItems: DiziPurchaseItem[] | null;
}

/** A row from `api/paymentsummary/customer` or `.../supplier`. */
export interface DiziPayment {
    Id: string;
    TraderId: string | null;
    IsSupplier: boolean | null;
    Amount: number | string | null;
    Date: string;
    SlipNo: string | null;
    TransactionNo: string | null;
    MethodName: string | null;
    AccountName: string | null;
    Narration: string | null;
    IsDeleted: boolean | null;
}

export interface DiziSaleReturnHeader {
    Id: string;
    ReturnSlipNo: string | null;
    ReturnDate: string;
    TraderId: string | null;
    GrossAmount: number | string | null;
    PaidAmount: number | string | null;
    DueAmount: number | string | null;
}

export interface DiziSaleReturnItem {
    ItemId: string | null;
    SaleItemId: string | null;
    Quantity: number | string | null;
    TotalAmount: number | string | null;
    PricePerItem: number | string | null;
}

export interface DiziSaleReturnDetail {
    Id: string;
    ReturnSlipNo: string | null;
    ReturnDate: string;
    /** GUID of the parent sale; the return is meaningless without it. */
    SalesId: string | null;
    TraderId: string | null;
    GrossAmount: number | string | null;
    TotalAmount: number | string | null;
    Narration: string | null;
    UpdatedOn?: string | null;
    ReturnItems: DiziSaleReturnItem[] | null;
}

export interface DiziCashierCredentials {
    baseUrl: string;
    username: string;
    password: string;
}

export interface DiziCashierSession {
    organizationId: string;
    organizationName: string;
    userName: string;
    fullName: string;
    isOwner: boolean;
}

const REQUEST_TIMEOUT_MS = 120_000;

/** List page size. Large enough to keep the page count (and round-trips) low. */
const LIST_PAGE_SIZE = 500;

/** Backstop so a misreported TotalItem cannot spin the pager forever. */
const MAX_LIST_PAGES = 2_000;

export class DiziCashierClient {
    private readonly logger = new Logger(DiziCashierClient.name);
    private readonly origin: string;
    private token: string | null = null;
    private session: DiziCashierSession | null = null;

    constructor(private readonly credentials: DiziCashierCredentials) {
        this.origin = assertValidBaseUrl(credentials.baseUrl);
    }

    getSession(): DiziCashierSession | null {
        return this.session;
    }

    /** Authenticates and captures the bearer token + org profile. */
    async login(): Promise<DiziCashierSession> {
        const res = await this.request('POST', 'api/account/login', {
            body: JSON.stringify({ UserName: this.credentials.username, Password: this.credentials.password }),
            headers: { 'Content-Type': 'application/json' },
            skipAuthCheck: true,
        });
        const payload = await this.readJson(res, 'api/account/login');

        if (res.status === 400 || res.status === 401) {
            throw new UnauthorizedException(
                payload?.error_description || payload?.Message || 'Dizi Cashier rejected the configured credentials',
            );
        }
        const token = payload?.access_token;
        if (!res.ok || !token) {
            throw new BadGatewayException(
                `Dizi Cashier login failed (HTTP ${res.status}): ${payload?.error_description ?? payload?.Message ?? 'unknown error'}`,
            );
        }

        this.token = String(token);
        this.session = {
            organizationId: String(payload.OrganizationId ?? ''),
            organizationName: String(payload.OrganizationName ?? ''),
            userName: String(payload.UserName ?? ''),
            fullName: String(payload.FullName ?? ''),
            isOwner: String(payload.IsOwner ?? '').toLowerCase() === 'true',
        };
        return this.session;
    }

    fetchProducts(): Promise<DiziItem[]> {
        return this.fetchList<DiziItem>('api/item', 'Name-desc', 'products');
    }

    fetchCustomers(): Promise<DiziTrader[]> {
        return this.fetchList<DiziTrader>('api/trader/customer', 'Name-desc', 'customers');
    }

    fetchSuppliers(): Promise<DiziTrader[]> {
        return this.fetchList<DiziTrader>('api/trader/supplier', 'Name-desc', 'suppliers');
    }

    fetchSaleHeaders(): Promise<DiziSaleHeader[]> {
        return this.fetchList<DiziSaleHeader>('api/sales/', 'TransactionDate-desc', 'sales');
    }

    fetchSaleDetail(id: string): Promise<DiziSaleDetail> {
        return this.fetchDetail<DiziSaleDetail>(`api/sales/${encodeURIComponent(id)}`);
    }

    fetchPurchaseHeaders(): Promise<DiziPurchaseHeader[]> {
        return this.fetchList<DiziPurchaseHeader>('api/purchase', 'TransactionDate-desc', 'purchases');
    }

    fetchPurchaseDetail(id: string): Promise<DiziPurchaseDetail> {
        return this.fetchDetail<DiziPurchaseDetail>(`api/purchase/${encodeURIComponent(id)}`);
    }

    fetchCustomerPayments(): Promise<DiziPayment[]> {
        return this.fetchList<DiziPayment>('api/paymentsummary/customer', 'CreatedOn-desc', 'customer payments');
    }

    fetchSupplierPayments(): Promise<DiziPayment[]> {
        return this.fetchList<DiziPayment>('api/paymentsummary/supplier', 'CreatedOn-desc', 'supplier payments');
    }

    fetchSaleReturnHeaders(): Promise<DiziSaleReturnHeader[]> {
        return this.fetchList<DiziSaleReturnHeader>('api/SalesReturn/', 'ReturnDate-desc', 'sale returns');
    }

    fetchSaleReturnDetail(id: string): Promise<DiziSaleReturnDetail> {
        return this.fetchDetail<DiziSaleReturnDetail>(`api/SalesReturn/${encodeURIComponent(id)}`);
    }

    /**
     * Walks a paginated list endpoint to completion. Stops when the collected
     * count reaches the reported `TotalItem`, when a page comes back empty, or
     * at the hard page cap — whichever is first, so a wrong TotalItem cannot
     * loop forever or truncate the data silently.
     */
    private async fetchList<T>(path: string, sort: string, label: string): Promise<T[]> {
        const rows: T[] = [];
        let page = 1;
        let total = Infinity;

        while (page <= MAX_LIST_PAGES) {
            const query = new URLSearchParams({
                page: String(page),
                itemsPerPage: String(LIST_PAGE_SIZE),
                sort,
            });
            const sep = path.includes('?') ? '&' : '?';
            const data = await this.getJson(`${path}${sep}${query.toString()}`);

            const modelList = data?.ModelList;
            if (!Array.isArray(modelList)) {
                throw new BadGatewayException(
                    `Dizi Cashier ${path} returned no "Data.ModelList" array — the upstream response shape changed`,
                );
            }
            rows.push(...(modelList as T[]));

            const reported = Number(data?.TotalItem);
            if (Number.isFinite(reported) && reported >= 0) total = reported;

            if (modelList.length === 0 || rows.length >= total || modelList.length < LIST_PAGE_SIZE) break;
            page += 1;
        }

        this.logger.debug(`Fetched ${rows.length} ${label} from Dizi Cashier`);
        return rows;
    }

    private async fetchDetail<T>(path: string): Promise<T> {
        const data = await this.getJson(path);
        if (!data || typeof data !== 'object') {
            throw new BadGatewayException(`Dizi Cashier ${path} returned no document body`);
        }
        return data as T;
    }

    private async getJson(path: string): Promise<any> {
        const res = await this.request('GET', path);
        const payload = await this.readJson(res, path);
        if (res.status === 401) {
            throw new UnauthorizedException('Dizi Cashier session expired mid-import — re-run to continue');
        }
        // The envelope is `{Success, Data}`; a false Success carries an
        // ErrorMessage (often a raw SQL error) rather than an HTTP failure.
        if (!res.ok || payload?.Success === false) {
            throw new BadGatewayException(
                `Dizi Cashier ${path} failed (HTTP ${res.status}): ${payload?.ErrorMessage ?? 'unknown error'}`,
            );
        }
        return payload?.Data ?? payload;
    }

    private async readJson(res: Response, path: string): Promise<any> {
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            if (text.trimStart().startsWith('<')) {
                throw new BadGatewayException(
                    `Dizi Cashier ${path} returned HTML instead of JSON — the endpoint or session is wrong`,
                );
            }
            throw new BadGatewayException(`Dizi Cashier ${path} returned a non-JSON response`);
        }
    }

    private async request(
        method: 'GET' | 'POST',
        path: string,
        options: { body?: BodyInit; headers?: Record<string, string>; skipAuthCheck?: boolean } = {},
    ): Promise<Response> {
        if (!options.skipAuthCheck && !this.token) {
            throw new UnauthorizedException('Dizi Cashier client is not logged in');
        }

        const headers: Record<string, string> = {
            Accept: 'application/json, text/plain, */*',
            ...options.headers,
        };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;

        try {
            return await fetch(`${this.origin}/${path}`, {
                method,
                headers,
                body: options.body,
                redirect: 'manual',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error: any) {
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
                throw new BadGatewayException(
                    `Dizi Cashier ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
                );
            }
            throw new BadGatewayException(`Dizi Cashier ${path} is unreachable: ${error?.message ?? error}`);
        }
    }
}
