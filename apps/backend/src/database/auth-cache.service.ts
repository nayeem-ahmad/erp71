import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { TtlLruCache } from '../common/ttl-lru-cache';

/** Long enough to carry a burst of page loads, short enough to be a safety net only. */
export const AUTH_CACHE_DEFAULT_TTL_MS = 30_000;
/** Per family. A few hundred bytes each, so the whole cache stays in the low megabytes. */
export const AUTH_CACHE_MAX_ENTRIES = 5_000;
/** Optional DI token, for tests that want a particular clock or TTL. */
export const AUTH_CACHE_OPTIONS = Symbol('AUTH_CACHE_OPTIONS');

export interface AuthCacheOptions {
    ttlMs: number;
    maxEntries: number;
    now?: () => number;
}

/**
 * `AUTH_CACHE_TTL_MS`, read once at boot. `0` turns the cache off; unset,
 * blank or unreadable falls back to the default — an unreadable value is
 * logged rather than treated as "off", because the kill switch is a deliberate
 * `0`, not whatever a typo happens to parse as.
 */
export function resolveAuthCacheTtlMs(raw: string | undefined, logger?: Pick<Logger, 'warn'>): number {
    if (raw === undefined || raw.trim() === '') return AUTH_CACHE_DEFAULT_TTL_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
        logger?.warn(`Ignoring AUTH_CACHE_TTL_MS=${JSON.stringify(raw)}; using ${AUTH_CACHE_DEFAULT_TTL_MS} ms`);
        return AUTH_CACHE_DEFAULT_TTL_MS;
    }
    return Math.floor(parsed);
}

type Family = 'user' | 'membership' | 'grants' | 'storeAccess' | 'store';
const MEMBER_FAMILIES = ['membership', 'grants', 'storeAccess'] as const;

/**
 * Key parts are joined with NUL rather than `:`. The tenant and store ids come
 * from request headers, so they can contain anything a header can — but not
 * NUL, which Node's HTTP parser refuses. That makes every key unambiguous: no
 * pair of header values can spell another pair's key, and no prefix or suffix
 * match during invalidation can reach a key it was not aimed at.
 */
const SEP = '\u0000';
const keyOf = (family: Family, ...parts: string[]) => [family, ...parts].join(SEP);

const isPresent = (value: unknown) => value !== null && value !== undefined;
const always = () => true;

/**
 * The answers every authenticated request asks before its handler runs —
 * who the token belongs to, whether they are a member of the workspace in the
 * header, which branches they can use there and what they may do in each — kept
 * in process for a short while instead of re-read on every request.
 *
 * **Why in process is enough.** The backend runs as exactly one Node process
 * (`node apps/backend/dist/src/main.js`, no cluster), so there is one copy of
 * this cache and every write that changes an answer runs in the same process
 * that holds it. Invalidation is a function call, not a message. If the backend
 * is ever scaled out to several processes this stops being true and the
 * invalidation calls would have to become a broadcast.
 *
 * **Invalidation is the mechanism; the TTL is the safety net.** Every write
 * that changes one of these answers calls one of the `invalidate*` methods
 * after it commits — signing out, a password change, a role change, removing a
 * member, revoking a branch — so the next request reads the new answer. The TTL
 * only bounds how long a write that forgot to call it could go unnoticed.
 * `auth-cache.invalidation.spec.ts` lists every file that writes these tables
 * and fails when a new one appears, so forgetting is at least a conscious act.
 *
 * Invalidate **after** the transaction commits, never inside it: a request
 * arriving between the invalidation and the commit would read the old rows and
 * put them straight back for a full TTL.
 *
 * **What is cached is the load in flight, not only its result.** Two requests
 * racing in the same tick share one query instead of both missing. A load that
 * fails is withdrawn so the next caller retries rather than inheriting the
 * error, and an entry is only ever written when its load *starts* — so a load
 * that began before an invalidation and finishes after it cannot put the stale
 * answer back.
 *
 * Absences are not cached: no such user, no such membership, no such store.
 * Each would need invalidating on *create* as well as on change, and they are
 * rare — a deleted account's token, a stale workspace header — so there is
 * nothing to save. Empty lists (a member with no branch access yet) *are*
 * cached, because those are ordinary answers.
 *
 * Everything returned is shared between requests, so callers must treat it as
 * read-only.
 *
 * `AUTH_CACHE_TTL_MS=0` turns all of it off: every call goes straight to its
 * loader, exactly as before this existed.
 */
@Injectable()
export class AuthCacheService {
    private readonly logger = new Logger(AuthCacheService.name);
    readonly ttlMs: number;
    private readonly families: Record<Family, TtlLruCache<Promise<unknown>>>;

    constructor(@Optional() @Inject(AUTH_CACHE_OPTIONS) options?: Partial<AuthCacheOptions>) {
        this.ttlMs = options?.ttlMs ?? resolveAuthCacheTtlMs(process.env.AUTH_CACHE_TTL_MS, this.logger);
        const maxEntries = options?.maxEntries ?? AUTH_CACHE_MAX_ENTRIES;
        const make = () => new TtlLruCache<Promise<unknown>>({ ttlMs: this.ttlMs, maxEntries, now: options?.now });
        this.families = {
            user: make(),
            membership: make(),
            grants: make(),
            storeAccess: make(),
            store: make(),
        };
    }

    get enabled(): boolean {
        return this.ttlMs > 0;
    }

    /** `user:{userId}` — the row `JwtStrategy` checks a token against. */
    user<T>(userId: string, load: () => Promise<T>): Promise<T> {
        return this.remember<T>('user', keyOf('user', userId), load, isPresent);
    }

    /** `membership:{userId}:{tenantId}` — role, roles and tenant, for the guards and `TenantInterceptor`. */
    membership<T>(userId: string, tenantId: string, load: () => Promise<T>): Promise<T> {
        return this.remember<T>('membership', keyOf('membership', userId, tenantId), load, isPresent);
    }

    /** `grants:{userId}:{tenantId}` — every store permission the member holds in the workspace. */
    grants<T>(userId: string, tenantId: string, load: () => Promise<T>): Promise<T> {
        return this.remember<T>('grants', keyOf('grants', userId, tenantId), load, always);
    }

    /** `storeAccess:{userId}:{tenantId}` — the branches the member may use in the workspace. */
    storeAccess<T>(userId: string, tenantId: string, load: () => Promise<T>): Promise<T> {
        return this.remember<T>('storeAccess', keyOf('storeAccess', userId, tenantId), load, always);
    }

    /**
     * `store:{tenantId}:{storeId}` — that the branch belongs to the workspace.
     * Only ever cached when it does, and a store never changes workspace and is
     * never deleted in-app, so no write has to invalidate it; tenant-wide
     * invalidation clears it anyway.
     */
    tenantStore<T>(tenantId: string, storeId: string, load: () => Promise<T>): Promise<T> {
        return this.remember<T>('store', keyOf('store', tenantId, storeId), load, isPresent);
    }

    /**
     * Everything about one person: their user row, and their membership, grants
     * and branch access in every workspace. For sign-out, a password change, a
     * platform-admin grant or revoke, an email change and deleting the account.
     */
    invalidateUser(userId: string): void {
        this.families.user.delete(keyOf('user', userId));
        const prefix = (family: Family) => keyOf(family, userId) + SEP;
        for (const family of MEMBER_FAMILIES) {
            const start = prefix(family);
            this.families[family].deleteWhere((key) => key.startsWith(start));
        }
    }

    /** One person in one workspace: a role change, a branch granted or revoked, removal. */
    invalidateMember(userId: string, tenantId: string): void {
        for (const family of MEMBER_FAMILIES) {
            this.families[family].delete(keyOf(family, userId, tenantId));
        }
    }

    /**
     * Everyone in one workspace — for writes whose reach is a set of members
     * rather than one: a role's permissions or name edited, a branch created, the
     * workspace deleted or its timezone changed.
     */
    invalidateTenant(tenantId: string): void {
        const end = SEP + tenantId;
        for (const family of MEMBER_FAMILIES) {
            this.families[family].deleteWhere((key) => key.endsWith(end));
        }
        const start = keyOf('store', tenantId) + SEP;
        this.families.store.deleteWhere((key) => key.startsWith(start));
    }

    clear(): void {
        for (const cache of Object.values(this.families)) cache.clear();
    }

    private remember<T>(family: Family, key: string, load: () => Promise<T>, keep: (value: T) => boolean): Promise<T> {
        if (!this.enabled) return load();

        const cache = this.families[family];
        const hit = cache.get(key) as Promise<T> | undefined;
        if (hit) return hit;

        let pending: Promise<T>;
        try {
            pending = load();
        } catch (err) {
            return Promise.reject(err);
        }

        cache.set(key, pending);
        // `deleteIfCurrent`, not `delete`: by the time this settles an
        // invalidation and a fresh load may already have replaced the entry,
        // and that newer one must survive.
        pending.then(
            (value) => {
                if (!keep(value)) cache.deleteIfCurrent(key, pending);
            },
            () => {
                cache.deleteIfCurrent(key, pending);
            },
        );
        return pending;
    }
}
