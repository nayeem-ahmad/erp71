/**
 * The platform's default inventory reason catalogues.
 *
 * FOUND is split out here because it has two callers that must not drift:
 * `seed.ts`, which runs once when a tenant is created, and
 * `sync-found-reasons.ts`, which carries the same catalogue to tenants that
 * predate it. A third copy already exists as the INSERT in
 * `migrations/20260916160000_inventory_found_stock/migration.sql` — that one is
 * the historical record for a database built by `prisma migrate`, and is inert
 * in production, which reconciles with `prisma db push` and never runs
 * migration files.
 *
 * SHRINKAGE (Product Lost) and DISCREPANCY (stock take) are the same shape:
 * `seed.ts` writes them at tenant creation, and `sync-inventory-reasons.ts`
 * carries missing codes to tenants that predate the catalogue or that only
 * ever saved a blank custom row. Production never runs the seed against an
 * existing workspace.
 *
 * Order here is the order the picker shows them in. `display_order` is assigned
 * from the index by both callers, so the two agree on relative order even
 * though they number from different bases.
 */
export const DEFAULT_FOUND_REASONS: ReadonlyArray<{ code: string; label: string }> = [
    { code: 'MISCOUNT', label: 'Miscount' },
    { code: 'UNRECORDED_RETURN', label: 'Unrecorded Customer Return' },
    { code: 'UNRECORDED_RECEIPT', label: 'Unrecorded Supplier Receipt' },
    { code: 'UNKNOWN', label: 'Unknown Surplus' },
];

export const DEFAULT_SHRINKAGE_REASONS: ReadonlyArray<{ code: string; label: string }> = [
    { code: 'THEFT', label: 'Theft' },
    { code: 'DAMAGE', label: 'Damage' },
    { code: 'EXPIRATION', label: 'Expiration' },
    { code: 'UNKNOWN', label: 'Unknown Loss' },
];

export const DEFAULT_DISCREPANCY_REASONS: ReadonlyArray<{ code: string; label: string }> = [
    { code: 'COUNT_ERROR', label: 'Count Error' },
    { code: 'RECONCILIATION', label: 'Reconciliation Adjustment' },
];
