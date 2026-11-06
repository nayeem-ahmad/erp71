import { api } from '@/lib/api';
import type { ListFilter } from '@/components/data-table';

/** The customer filter's value for a walk-in document (no customer), as the server reads it. */
export const NO_CUSTOMER = 'none';
/** Customers offered per typed search. */
const CUSTOMER_SEARCH_LIMIT = 20;

/**
 * The Customer chip on a sales-side list's filter row, as on the Sales list.
 * A tenant can have thousands of customers, so the box asks the server as it
 * is typed in; before anything is typed it offers "Walk-in" alone. Leave
 * `walkInLabel` out on a list whose rows always carry a customer.
 */
export function customerListFilter({
    label,
    walkInLabel,
    value,
    onChange,
    storeId,
    more,
}: {
    label: string;
    walkInLabel?: string;
    value: string[];
    onChange: (next: string[]) => void;
    /** The page's branch scope, so the search offers that branch's customers. */
    storeId?: string;
    more?: boolean;
}): ListFilter {
    return {
        id: 'customer',
        type: 'multi-select',
        label,
        value,
        onChange,
        options: walkInLabel ? [{ value: NO_CUSTOMER, label: walkInLabel }] : [],
        loadOptions: (query) =>
            api.searchCustomers(query, CUSTOMER_SEARCH_LIMIT, storeId).then((rows: { id: string; name: string }[]) =>
                rows.map((row) => ({ value: row.id, label: row.name })),
            ),
        ...(more ? { more } : {}),
    };
}
