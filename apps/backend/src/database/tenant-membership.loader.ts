import { DatabaseService } from './database.service';
import { TenantRecordScope } from '@erp71/shared-types';

/**
 * The membership row, with every field any of its four readers needs.
 */
export interface LoadedTenantMembership {
    tenant_id: string;
    user_id: string;
    role: string;
    tenant: { deleted_at: Date | null; timezone: string | null };
    roles: { tenantRole: { name: string; record_scope: TenantRecordScope } }[];
}

/** What the joined query below returns, before it is reshaped for callers. */
interface MembershipRow {
    tenant_id: string;
    user_id: string;
    role: string;
    tenant_deleted_at: Date | null;
    tenant_timezone: string | null;
    roles: { name: string; record_scope: string }[] | null;
}

const CACHE_KEY = Symbol('erp71.tenantMembership');

type MembershipCache = Map<string, Promise<LoadedTenantMembership | null>>;

/**
 * Reads a member's row for `(tenantId, userId)` once per request, in one query.
 *
 * Two separate costs used to sit on this path, and this closes both.
 *
 * The first was repetition. Four things need this row — `SubscriptionAccessGuard`,
 * `TenantRoleGuard` and `StorePermissionGuard` to decide access, and
 * `TenantInterceptor` to resolve the tenant, its timezone and the member's
 * record scope. Guards run before interceptors, so whichever of them a route
 * carries each read it again, and a gated request read it up to three times in
 * sequence. The row cannot change mid-request, so the repeats were pure
 * latency — nothing was rechecked, the same row was fetched again. The cache
 * hangs off the request object rather than module state, so it cannot outlive the
 * request or leak one caller's membership to another, and the *promise* is cached
 * rather than its result, so two readers racing in the same tick share one query
 * instead of both missing.
 *
 * The second was the shape of the read. Prisma does not join a nested `select` —
 * it issues one query per relation level — so asking for the member plus their
 * tenant plus their roles plus those roles' definitions cost four sequential
 * round trips, on every authenticated request. Written as one join it is one.
 * That is also four fewer turns holding a pooled connection, which is what
 * actually bounds throughput when several people are using the app at once.
 *
 * Callers apply their own predicates to what comes back. The soft-delete check
 * in particular stays at the call site: `TenantInterceptor` rejects a member of
 * a soft-deleted tenant, the guards do not, and unifying that here would change
 * which status code a stale tenant header returns.
 */
export async function loadTenantMembership(
    db: DatabaseService,
    request: any,
    tenantId: string,
    userId: string,
): Promise<LoadedTenantMembership | null> {
    const cache: MembershipCache = request?.[CACHE_KEY] ?? new Map();
    if (request && !request[CACHE_KEY]) request[CACHE_KEY] = cache;

    const key = `${tenantId}\u0000${userId}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const pending = fetchMembership(db, tenantId, userId);
    cache.set(key, pending);

    try {
        return await pending;
    } catch (err) {
        // A failed read must not be remembered: the next reader on this request
        // would inherit the rejection instead of getting its own chance.
        cache.delete(key);
        throw err;
    }
}

async function fetchMembership(
    db: DatabaseService,
    tenantId: string,
    userId: string,
): Promise<LoadedTenantMembership | null> {
    // The enums are cast to text so the driver hands back plain strings, and the
    // roles are aggregated here so a member with several of them still comes
    // back as one row. `FILTER` keeps the aggregate empty — rather than a row of
    // nulls — for a member who holds none.
    //
    // These four table names are written out, so none of them may be given an
    // `@@map` in schema.prisma without changing them here too — Prisma would
    // rename the table and this query would fail at runtime, not at build time.
    // None of them has one today.
    const rows = await db.$queryRaw<MembershipRow[]>`
        SELECT tu.tenant_id,
               tu.user_id,
               tu.role::text   AS role,
               t.deleted_at    AS tenant_deleted_at,
               t.timezone      AS tenant_timezone,
               COALESCE(
                   json_agg(
                       json_build_object('name', tr.name, 'record_scope', tr.record_scope::text)
                   ) FILTER (WHERE tr.id IS NOT NULL),
                   '[]'::json
               )               AS roles
        FROM "TenantUser" tu
        JOIN "Tenant" t            ON t.id = tu.tenant_id
        LEFT JOIN "TenantUserRole" tur ON tur.tenant_user_id = tu.id
        LEFT JOIN "TenantRole" tr      ON tr.id = tur.tenant_role_id
        WHERE tu.tenant_id = ${tenantId}
          AND tu.user_id = ${userId}
        GROUP BY tu.tenant_id, tu.user_id, tu.role, t.deleted_at, t.timezone
    `;

    const row = rows[0];
    if (!row) return null;

    return {
        tenant_id: row.tenant_id,
        user_id: row.user_id,
        role: row.role,
        tenant: { deleted_at: row.tenant_deleted_at, timezone: row.tenant_timezone },
        roles: (row.roles ?? []).map((r) => ({
            tenantRole: {
                name: r.name,
                record_scope: r.record_scope as TenantRecordScope,
            },
        })),
    };
}
