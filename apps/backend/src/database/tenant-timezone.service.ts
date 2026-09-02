import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { DEFAULT_TENANT_TIMEZONE, resolveZone } from '../common/tenant-time.util';

/**
 * The tenant's IANA timezone, for every code path that has to know what "today"
 * means for a particular workspace.
 *
 * Why a service and not just a value on the request: the scheduled sweeps need
 * it too. `autoCreateBirthdayActivities` and friends iterate every tenant on the
 * platform from a `@Cron`, where there is no request to hang anything off. A
 * request-only design would have left exactly the jobs that reason about
 * calendar days unable to reason about them.
 *
 * The cache exists because this is consulted on essentially every list endpoint,
 * and an extra `Tenant` read per request to fetch a string that changes once a
 * year would be a poor trade. Entries are short-lived and `invalidate` clears
 * one immediately, so a settings change takes effect on the next request rather
 * than in five minutes.
 */
@Injectable()
export class TenantTimezoneService {
    /** Long enough to matter under load, short enough that a missed invalidation self-heals. */
    private static readonly TTL_MS = 5 * 60 * 1000;

    private readonly cache = new Map<string, { zone: string; expiresAt: number }>();

    constructor(private readonly db: DatabaseService) { }

    /**
     * The zone for one tenant, falling back to the platform default for an
     * unknown id. Callers are query paths, so a missing tenant must not throw
     * here — whatever they do next will fail on its own terms and say so better.
     */
    async for(tenantId: string | null | undefined): Promise<string> {
        if (!tenantId) return DEFAULT_TENANT_TIMEZONE;

        const cached = this.cache.get(tenantId);
        if (cached && cached.expiresAt > Date.now()) return cached.zone;

        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { timezone: true },
        });

        const zone = resolveZone(tenant?.timezone);
        this.prime(tenantId, zone);
        return zone;
    }

    /**
     * Zones for a batch of tenants in one query — for the cron sweeps, which
     * would otherwise issue a `Tenant` read per tenant per night.
     */
    async forMany(tenantIds: string[]): Promise<Map<string, string>> {
        const wanted = [...new Set(tenantIds.filter(Boolean))];
        const resolved = new Map<string, string>();

        const missing: string[] = [];
        for (const id of wanted) {
            const cached = this.cache.get(id);
            if (cached && cached.expiresAt > Date.now()) resolved.set(id, cached.zone);
            else missing.push(id);
        }

        if (missing.length > 0) {
            const rows = await this.db.tenant.findMany({
                where: { id: { in: missing } },
                select: { id: true, timezone: true },
            });
            const found = new Map(rows.map((row) => [row.id, resolveZone(row.timezone)]));
            for (const id of missing) {
                const zone = found.get(id) ?? DEFAULT_TENANT_TIMEZONE;
                this.prime(id, zone);
                resolved.set(id, zone);
            }
        }

        return resolved;
    }

    /**
     * Records a zone already fetched elsewhere. `TenantInterceptor` reads it
     * alongside the membership check it was making anyway, so on the HTTP path
     * this service usually never touches the database at all.
     */
    prime(tenantId: string, timezone: string | null | undefined): void {
        this.cache.set(tenantId, {
            zone: resolveZone(timezone),
            expiresAt: Date.now() + TenantTimezoneService.TTL_MS,
        });
    }

    /** Called when a tenant changes its zone, so the next request sees the new one. */
    invalidate(tenantId: string): void {
        this.cache.delete(tenantId);
    }
}
