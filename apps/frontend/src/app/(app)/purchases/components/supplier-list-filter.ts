import { api } from '@/lib/api';
import type { ListFilter } from '@/components/data-table';

/** The supplier filter's value for a document with no supplier, as the server reads it. */
export const NO_SUPPLIER = 'none';
/** Suppliers offered per typed search. */
const SUPPLIER_SEARCH_LIMIT = 20;

/**
 * The Supplier chip on a purchase-side list's filter row. A tenant can have
 * thousands of suppliers, so the box asks the server as it is typed in; before
 * anything is typed it offers "No supplier" alone.
 */
export function supplierListFilter({
    label,
    noSupplierLabel,
    value,
    onChange,
    more,
}: {
    label: string;
    noSupplierLabel: string;
    value: string[];
    onChange: (next: string[]) => void;
    more?: boolean;
}): ListFilter {
    return {
        id: 'supplier',
        type: 'multi-select',
        label,
        value,
        onChange,
        options: [{ value: NO_SUPPLIER, label: noSupplierLabel }],
        loadOptions: (query) =>
            api
                .getSuppliersPaged({ search: query, limit: SUPPLIER_SEARCH_LIMIT })
                .then((page: { items: { id: string; name: string }[] }) =>
                    page.items.map((row) => ({ value: row.id, label: row.name })),
                ),
        ...(more ? { more } : {}),
    };
}
