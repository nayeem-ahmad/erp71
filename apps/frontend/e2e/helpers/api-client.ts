import { E2E_API_URL } from './auth';
import type { DemoSession } from './demo-auth';
import { authHeaders } from './demo-auth';

type ApiEnvelope<T> = { data: T };

async function parseJson<T>(res: Response): Promise<T> {
    if (!res.ok) {
        throw new Error(`API ${res.url} → ${res.status}: ${await res.text()}`);
    }
    const body = await res.json();
    return (body.data ?? body) as T;
}

async function fetchWithRetry(
    url: string,
    init: RequestInit,
    attempts = 4,
): Promise<Response> {
    let lastRes: Response | null = null;
    for (let i = 0; i < attempts; i++) {
        const res = await fetch(url, init);
        if (res.status !== 429) return res;
        lastRes = res;
        await new Promise((resolve) => setTimeout(resolve, (i + 1) * 500));
    }
    return lastRes!;
}

export async function apiGet<T>(session: DemoSession, path: string): Promise<T> {
    const res = await fetchWithRetry(`${E2E_API_URL}/api/v1${path}`, { headers: authHeaders(session) });
    return parseJson<T>(res);
}

export async function apiPost<T>(session: DemoSession, path: string, payload: unknown): Promise<T> {
    const res = await fetchWithRetry(`${E2E_API_URL}/api/v1${path}`, {
        method: 'POST',
        headers: authHeaders(session),
        body: JSON.stringify(payload),
    });
    return parseJson<T>(res);
}

export interface ProductSummary {
    id: string;
    name: string;
    sku?: string | null;
    price: number | string;
}

export interface CustomerSummary {
    id: string;
    name: string;
    phone: string;
}

export interface SupplierSummary {
    id: string;
    name: string;
}

export async function listProducts(session: DemoSession): Promise<ProductSummary[]> {
    const result = await apiGet<{ items?: ProductSummary[] } | ProductSummary[]>(session, '/products?limit=50');
    if (Array.isArray(result)) return result;
    return result.items ?? [];
}

export async function listCustomers(session: DemoSession): Promise<CustomerSummary[]> {
    return apiGet<CustomerSummary[]>(session, '/customers');
}

export async function listSuppliers(session: DemoSession): Promise<SupplierSummary[]> {
    return apiGet<SupplierSummary[]>(session, '/suppliers');
}

export interface AccountSummary {
    id: string;
    name: string;
    code?: string | null;
    type: string;
}

export async function listAccounts(session: DemoSession): Promise<AccountSummary[]> {
    const result = await apiGet<AccountSummary[] | { items?: AccountSummary[] }>(session, '/accounting/accounts');
    if (Array.isArray(result)) return result;
    return result.items ?? [];
}

export async function upsertBudget(
    session: DemoSession,
    payload: { accountId: string; fiscalYear: number; month?: number; amount: number },
) {
    return apiPost(session, '/accounting/budgets', payload);
}

export async function getAccountingOverview(session: DemoSession) {
    return apiGet(session, '/accounting');
}

export async function lockFiscalPeriod(
    session: DemoSession,
    payload: { year: number; month: number },
) {
    return apiPost(session, '/accounting/settings/fiscal-periods/lock', payload);
}

export async function unlockFiscalPeriod(
    session: DemoSession,
    payload: { year: number; month: number },
) {
    return apiPost(session, '/accounting/settings/fiscal-periods/unlock', payload);
}

export async function importOpeningBalances(
    session: DemoSession,
    payload: {
        asOfDate: string;
        entries: Array<{ accountId: string; debitAmount: number; creditAmount: number }>;
    },
) {
    return apiPost(session, '/accounting/opening-balances', payload);
}

export async function createCostCenter(
    session: DemoSession,
    payload: { code: string; name: string },
) {
    return apiPost(session, '/accounting/cost-centers', payload);
}

export async function createFixedAsset(
    session: DemoSession,
    payload: {
        assetCode: string;
        name: string;
        purchaseDate: string;
        cost: number;
        residualValue?: number;
        usefulLifeMonths: number;
        depreciationMethod?: string;
    },
) {
    return apiPost(session, '/accounting/fixed-assets', payload);
}

export async function runDepreciation(
    session: DemoSession,
    payload: { year: number; month: number },
) {
    return apiPost(session, '/accounting/fixed-assets/run-depreciation', payload);
}

export async function createRecurringJournal(
    session: DemoSession,
    payload: {
        name: string;
        frequency: string;
        nextDueDate: string;
        lines: Array<{ accountId: string; debitAmount: number; creditAmount: number }>;
    },
) {
    return apiPost(session, '/accounting/recurring-journals', payload);
}

export async function postRecurringJournal(session: DemoSession, id: string) {
    return apiPost(session, `/accounting/recurring-journals/${id}/post`, {});
}

export async function createBankReconciliation(
    session: DemoSession,
    payload: { accountId: string; statementDate: string; statementClosingBalance: number },
) {
    return apiPost<{ id: string }>(session, '/accounting/bank-reconciliations', payload);
}

export async function importBankStatementEntries(
    session: DemoSession,
    payload: {
        reconciliationId: string;
        entries: Array<{ entryDate: string; description?: string; amount: number; entryType: string }>;
    },
) {
    return apiPost(session, '/accounting/bank-reconciliations/import', payload);
}

export async function autoMatchBankEntries(session: DemoSession, reconciliationId: string) {
    return apiPost(session, `/accounting/bank-reconciliations/${reconciliationId}/auto-match`, {});
}

export interface DemoStoreSummary {
    id: string;
    name: string;
}

export async function listDemoStores(session: DemoSession): Promise<DemoStoreSummary[]> {
    const me = await apiGet<{ tenants?: Array<{ stores?: DemoStoreSummary[] }> }>(session, '/auth/me');
    return me.tenants?.[0]?.stores ?? [];
}

export async function getProfitLossReport(
    session: DemoSession,
    params: { from?: string; to?: string; scope?: string; storeId?: string; storeIds?: string },
) {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.scope) q.set('scope', params.scope);
    if (params.storeId) q.set('storeId', params.storeId);
    if (params.storeIds) q.set('storeIds', params.storeIds);
    return apiGet(session, `/accounting/reports/profit-loss?${q.toString()}`);
}

export async function initiateFundTransfer(
    session: DemoSession,
    payload: { sourceStoreId: string; destinationStoreId: string; amount: number; method?: string; description?: string },
) {
    return apiPost(session, '/fund-transfers', payload);
}

export async function receiveFundTransfer(session: DemoSession, id: string) {
    return apiPost(session, `/fund-transfers/${id}/receive`, {});
}