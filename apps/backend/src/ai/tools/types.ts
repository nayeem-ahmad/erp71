import { StorePermission } from '@erp71/shared-types';
import type { AccountingService } from '../../accounting/accounting.service';
import type { CustomersService } from '../../customers/customers.service';
import type { ExpensesService } from '../../expenses/expenses.service';
import type { InventoryReportsService } from '../../inventory-reports/inventory-reports.service';
import type { PurchaseReportsService } from '../../purchase-reports/purchase-reports.service';
import type { SalesReportsService } from '../../sales-reports/sales-reports.service';
import type { SuppliersService } from '../../suppliers/suppliers.service';
import type { ChatDataService } from '../chat-data.service';
import type { WebSearchService } from '../web-search.service';

/**
 * Shared vocabulary for the read-only tool menu the data chatbot may call.
 *
 * Two rules hold for every tool in every file under this directory:
 *
 *  1. `tenantId` is never a tool parameter — it comes from the JWT via
 *     `ChatToolContext`. Tenant isolation is therefore structural, not a
 *     property of the prompt. `chat-tools.spec.ts` asserts this.
 *  2. Results are projected down and row-capped before they go back to the
 *     model: a raw report row carries whole Prisma entities, and every row we
 *     return is billed again as input tokens on the next round-trip.
 */

/** Max rows any single tool may hand back to the model in one call. */
export const MAX_TOOL_ROWS = 20;

export interface ChatToolDeps {
    salesReports: SalesReportsService;
    inventoryReports: InventoryReportsService;
    purchaseReports: PurchaseReportsService;
    customers: CustomersService;
    suppliers: SuppliersService;
    expenses: ExpensesService;
    accounting: AccountingService;
    data: ChatDataService;
    web: WebSearchService;
}

export interface ChatToolContext {
    tenantId: string;
    userId: string;
    userRole?: string;
    /** Currently selected store, used as the default scope for store-aware tools. */
    storeId?: string;
    /** Every store in the tenant — the allow-list for a model-supplied `storeId`. */
    stores: Array<{ id: string; name: string }>;
    /** True when the caller may see figures spanning every branch at once. */
    hasConsolidatedAccess?: boolean;
    /**
     * URLs `fetch_web_page` is allowed to read this turn: the hits a `web_search`
     * returned, plus any link the user typed into their own message. A model-chosen
     * URL with nothing vouching for it is a request for the server to make an
     * arbitrary outbound call, so the allow-list is the boundary — not a hint.
     */
    fetchableUrls?: Set<string>;
    /**
     * Credits spent *inside* a tool. Only `web_search` uses it, because it makes
     * its own model call; the agent loop cannot see that cost, so tools add it here
     * and the turn folds it into the total shown against the answer.
     */
    toolCredits?: { total: number };
}

export interface ChatTool {
    name: string;
    /** Written for the model: say what it returns *and* when to reach for it. */
    description: string;
    /** Withheld from the tool list entirely when the caller lacks this. */
    permission: StorePermission;
    /**
     * Modules this tool is meaningless without. A tenant that sells nothing has
     * no use for a sales tool, and offering one invites the model to answer a
     * question with an empty report instead of saying it has no such data.
     */
    modules?: ChatToolModule[];
    /**
     * A platform-level switch this tool depends on, checked per turn. Distinct from
     * `modules`, which is about the tenant's subscription: this is about whether the
     * operator has enabled a capability that costs the platform money per call.
     */
    featureFlag?: ChatToolFeatureFlag;
    parameters: Record<string, unknown>;
    handler: (ctx: ChatToolContext, args: Record<string, any>, deps: ChatToolDeps) => Promise<unknown>;
}

/** Coarse product areas, used to hide tools a tenant's subscription cannot use. */
export type ChatToolModule = 'retail' | 'inventory' | 'accounting' | 'crm' | 'hr' | 'manufacturing';

/** Platform-operator switches a tool can depend on. */
export type ChatToolFeatureFlag = 'webSearch';

export const DATE_RANGE_PROPS = {
    from: { type: 'string', description: 'Start date, inclusive, as YYYY-MM-DD.' },
    to: { type: 'string', description: 'End date, inclusive, as YYYY-MM-DD.' },
};

export const STORE_PROP = {
    storeId: {
        type: 'string',
        description:
            'Restrict to one branch by its id, taken from the branch list in the system prompt. ' +
            'Omit for the whole business. Never invent an id.',
    },
};

export const COMPARE_PROP = {
    compareTo: {
        type: 'string',
        enum: ['previous_period', 'previous_year'],
        description:
            'Also return the same figures for a prior window and the change between them. ' +
            'Use this instead of calling the tool twice — "previous_period" is the equally long block ' +
            'of days immediately before the range, "previous_year" is the same dates one year earlier.',
    },
};

export const PAGING_PROPS = {
    limit: { type: 'number', description: `How many rows to return (max ${MAX_TOOL_ROWS}).` },
    offset: {
        type: 'number',
        description: 'Rows to skip before returning. Use it to page past a truncated result — e.g. offset 20 for the next 20.',
    },
};

/** 2dp is the most precision any BDT figure in this app carries. */
export function money(value: unknown): number {
    return Math.round(Number(value ?? 0) * 100) / 100;
}

export function pct(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 10) / 10;
}

export interface PageOptions {
    limit?: unknown;
    offset?: unknown;
}

/**
 * Caps a row list, applies an offset, and tells the model both what it got and
 * what remains, so it can say "the top 20 of 143" instead of silently
 * presenting a truncated list as complete — and can ask for the next page
 * rather than re-running the same query and getting the same 20 rows.
 */
export function page<T>(rows: T[], options: PageOptions = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || MAX_TOOL_ROWS, 1), MAX_TOOL_ROWS);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const window = rows.slice(offset, offset + limit);
    return {
        rows: window,
        totalRows: rows.length,
        returned: window.length,
        offset,
        hasMore: offset + window.length < rows.length,
        truncated: rows.length > offset + window.length,
    };
}

/**
 * Only lets through a store id that actually belongs to this tenant. A bad id is
 * dropped (widening to tenant-wide) rather than passed to Prisma, and the model
 * is told, so it does not report a filtered figure as branch-specific.
 */
export function resolveStoreId(ctx: ChatToolContext, requested?: string): { storeId?: string; note?: string } {
    if (!requested) return {};
    const match = ctx.stores.find((s) => s.id === requested);
    if (match) return { storeId: match.id };
    return {
        note: `Unknown branch id "${requested}" — this result covers the whole business, not one branch.`,
    };
}

/** Normalises a model-supplied date to `YYYY-MM-DD`, or undefined if unusable. */
export function asDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

/** Only forwards a comparison mode the report layer actually understands. */
export function asComparison(value: unknown): 'previous_period' | 'previous_year' | undefined {
    return value === 'previous_period' || value === 'previous_year' ? value : undefined;
}

export function isoDate(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
