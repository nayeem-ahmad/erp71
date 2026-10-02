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
