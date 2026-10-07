/** What a snapshot's manifest counts, in the order the import walks them. */
const COUNT_LABELS: Array<[key: string, label: string]> = [
    ['products', 'products'],
    ['customers', 'customers'],
    ['suppliers', 'suppliers'],
    ['purchases', 'purchases'],
    ['sales', 'sales'],
    ['quotations', 'quotations'],
    ['customerPayments', 'customer payments'],
    ['supplierPayments', 'supplier payments'],
    ['saleReturns', 'sale returns'],
];

export type SnapshotCountEntry = { key: string; label: string; count: number };

/**
 * How many of each record the extract found in the other system. A key the
 * snapshot never counted (quotations on an extract older than that step) is
 * left out rather than shown as 0, since 0 would claim the provider had none.
 */
export function snapshotCountEntries(counts: Record<string, number> | null | undefined): SnapshotCountEntry[] {
    if (!counts) return [];
    return COUNT_LABELS.filter(([key]) => typeof counts[key] === 'number').map(([key, label]) => ({
        key,
        label,
        count: counts[key],
    }));
}
