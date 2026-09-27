import { api } from '@/lib/api';
import type { FilterOption } from './SearchFilterPicker';

/**
 * The `search` functions `SearchFilterPicker` is given for each kind of record.
 * Each asks the server for a short list — never the whole table.
 */

/** The few fields each lookup is read for; the endpoints return more. */
type SearchedRecord = {
    id: string;
    name: string;
    sku?: string | null;
    phone?: string | null;
    customer_code?: string | null;
};

/** An empty term browses the best sellers, so the list reads without typing. */
export async function searchProductOptions(term: string): Promise<FilterOption[]> {
    const rows: SearchedRecord[] = await api.searchProductsByQuantity(term, term ? 20 : 30);
    return (Array.isArray(rows) ? rows : []).map((product) => ({
        id: product.id,
        name: product.name,
        detail: product.sku ?? null,
    }));
}

/** Matches name, owner, phone and customer code on the server. */
export async function searchCustomerOptions(term: string): Promise<FilterOption[]> {
    const rows: SearchedRecord[] = await api.searchCustomers(term, 20);
    return (rows ?? []).map((customer) => ({
        id: customer.id,
        name: customer.name,
        detail: customer.phone ?? customer.customer_code ?? null,
    }));
}

/** Matches name, phone, email and address on the server. */
export async function searchSupplierOptions(term: string): Promise<FilterOption[]> {
    const page = await api.getSuppliersPaged({ search: term || undefined, limit: 20 });
    return ((page?.items ?? []) as SearchedRecord[]).map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        detail: supplier.phone ?? null,
    }));
}
