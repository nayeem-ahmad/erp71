import {
    AUTH_CACHE_DEFAULT_TTL_MS,
    AuthCacheService,
    resolveAuthCacheTtlMs,
} from './auth-cache.service';

/** A promise the test settles by hand, to hold a load in flight. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Lets `.then` callbacks attached inside the cache run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('AuthCacheService', () => {
    let clock: number;
    const now = () => clock;
    const make = (ttlMs = 30_000, maxEntries = 5_000) => new AuthCacheService({ ttlMs, maxEntries, now });

    beforeEach(() => {
        clock = 1_000_000;
    });

    it('serves a second read from memory instead of calling the loader again', async () => {
        const cache = make();
        const load = jest.fn().mockResolvedValue({ id: 'user-1' });

        await expect(cache.user('user-1', load)).resolves.toEqual({ id: 'user-1' });
        await expect(cache.user('user-1', load)).resolves.toEqual({ id: 'user-1' });

        expect(load).toHaveBeenCalledTimes(1);
    });

    it('shares one load between requests racing for the same key', async () => {
        const cache = make();
        const gate = deferred<{ id: string }>();
        const load = jest.fn(() => gate.promise);

        const first = cache.user('user-1', load);
        const second = cache.user('user-1', load);
        gate.resolve({ id: 'user-1' });

        await expect(Promise.all([first, second])).resolves.toEqual([{ id: 'user-1' }, { id: 'user-1' }]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('reads again once the TTL has passed — the safety net', async () => {
        const cache = make(30_000);
        const load = jest.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });

        await cache.user('user-1', load);
        clock += 30_000;

        await expect(cache.user('user-1', load)).resolves.toEqual({ v: 2 });
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('never caches a failure: the next caller loads afresh', async () => {
        const cache = make();
        const load = jest
            .fn()
            .mockRejectedValueOnce(new Error('connection reset'))
            .mockResolvedValueOnce({ id: 'user-1' });

        await expect(cache.user('user-1', load)).rejects.toThrow('connection reset');
        await settle();

        await expect(cache.user('user-1', load)).resolves.toEqual({ id: 'user-1' });
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('never caches a loader that throws before returning a promise', async () => {
        const cache = make();
        const load = jest
            .fn()
            .mockImplementationOnce(() => {
                throw new Error('boom');
            })
            .mockResolvedValueOnce('ok');

        await expect(cache.grants('u', 't', load)).rejects.toThrow('boom');
        await expect(cache.grants('u', 't', load)).resolves.toBe('ok');
    });

    it('does not remember an absence — a missing user, membership or store is re-read', async () => {
        const cache = make();
        const user = jest.fn().mockResolvedValue(null);
        const membership = jest.fn().mockResolvedValue(null);
        const store = jest.fn().mockResolvedValue(null);

        for (let i = 0; i < 2; i += 1) {
            await cache.user('u', user);
            await cache.membership('u', 't', membership);
            await cache.tenantStore('t', 's', store);
            await settle();
        }

        expect(user).toHaveBeenCalledTimes(2);
        expect(membership).toHaveBeenCalledTimes(2);
        expect(store).toHaveBeenCalledTimes(2);
    });

    it('does remember an empty list — no branch access is an ordinary answer', async () => {
        const cache = make();
        const access = jest.fn().mockResolvedValue([]);
        const grants = jest.fn().mockResolvedValue(new Map());

        for (let i = 0; i < 2; i += 1) {
            await cache.storeAccess('u', 't', access);
            await cache.grants('u', 't', grants);
            await settle();
        }

        expect(access).toHaveBeenCalledTimes(1);
        expect(grants).toHaveBeenCalledTimes(1);
    });

    it('keeps the families apart: the same ids under different families are different keys', async () => {
        const cache = make();
        await cache.storeAccess('u', 't', async () => 'access');

        await expect(cache.grants('u', 't', async () => 'grants')).resolves.toBe('grants');
        await expect(cache.membership('u', 't', async () => 'membership')).resolves.toBe('membership');
    });

    it('cannot be made to confuse two header pairs that join to the same text', async () => {
        const cache = make();
        await cache.tenantStore('tenant-1:store-1', 'x', async () => 'first');

        await expect(cache.tenantStore('tenant-1', 'store-1:x', async () => 'second')).resolves.toBe('second');
    });

    it('turns itself off with a zero TTL — every call goes to the loader', async () => {
        const cache = make(0);
        const load = jest.fn().mockResolvedValue({ id: 'user-1' });

        await cache.user('user-1', load);
        await cache.user('user-1', load);

        expect(cache.enabled).toBe(false);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('caps each family on its own', async () => {
        const cache = make(30_000, 2);
        const load = jest.fn(async () => 'v');

        await cache.storeAccess('u1', 't', load);
        await cache.storeAccess('u2', 't', load);
        await cache.storeAccess('u3', 't', load); // pushes out u1
        await cache.grants('u1', 't', load); // another family: does not count
        await cache.storeAccess('u2', 't', load); // still there
        expect(load).toHaveBeenCalledTimes(4);

        await cache.storeAccess('u1', 't', load);
        expect(load).toHaveBeenCalledTimes(5);
    });

    describe('invalidation', () => {
        /** Fills every family for two users in two tenants. */
        async function seeded() {
            const cache = make();
            const loads = jest.fn(async () => 'v');
            for (const u of ['u1', 'u2']) {
                await cache.user(u, loads);
                for (const t of ['t1', 't2']) {
                    await cache.membership(u, t, loads);
                    await cache.grants(u, t, loads);
                    await cache.storeAccess(u, t, loads);
                }
            }
            for (const t of ['t1', 't2']) await cache.tenantStore(t, 's', loads);
            loads.mockClear();
            return { cache, loads };
        }

        /** Which of the seeded keys reload, as `family:ids`. */
        async function reloaded(cache: AuthCacheService) {
            const hits: string[] = [];
            const probe = (name: string) => async () => {
                hits.push(name);
                return 'v';
            };
            for (const u of ['u1', 'u2']) {
                await cache.user(u, probe(`user:${u}`));
                for (const t of ['t1', 't2']) {
                    await cache.membership(u, t, probe(`membership:${u}:${t}`));
                    await cache.grants(u, t, probe(`grants:${u}:${t}`));
                    await cache.storeAccess(u, t, probe(`storeAccess:${u}:${t}`));
                }
            }
            for (const t of ['t1', 't2']) await cache.tenantStore(t, 's', probe(`store:${t}:s`));
            return hits;
        }

        it('invalidateUser drops that person everywhere and nobody else', async () => {
            const { cache } = await seeded();
            cache.invalidateUser('u1');

            expect(await reloaded(cache)).toEqual([
                'user:u1',
                'membership:u1:t1',
                'grants:u1:t1',
                'storeAccess:u1:t1',
                'membership:u1:t2',
                'grants:u1:t2',
                'storeAccess:u1:t2',
            ]);
        });

        it('invalidateMember drops one person in one workspace', async () => {
            const { cache } = await seeded();
            cache.invalidateMember('u1', 't1');

            expect(await reloaded(cache)).toEqual(['membership:u1:t1', 'grants:u1:t1', 'storeAccess:u1:t1']);
        });

        it('invalidateTenant drops everyone in one workspace, its stores included', async () => {
            const { cache } = await seeded();
            cache.invalidateTenant('t1');

            expect(await reloaded(cache)).toEqual([
                'membership:u1:t1',
                'grants:u1:t1',
                'storeAccess:u1:t1',
                'membership:u2:t1',
                'grants:u2:t1',
                'storeAccess:u2:t1',
                'store:t1:s',
            ]);
        });

        it('clear drops everything', async () => {
            const { cache } = await seeded();
            cache.clear();

            expect(await reloaded(cache)).toHaveLength(2 + 2 * 2 * 3 + 2);
        });

        it('does not let a load that began before the invalidation put its stale answer back', async () => {
            const cache = make();
            const stale = deferred<string>();
            const inFlight = cache.membership('u1', 't1', () => stale.promise);

            // The member is removed while their request is still reading.
            cache.invalidateMember('u1', 't1');
            stale.resolve('still a member');
            await expect(inFlight).resolves.toBe('still a member');
            await settle();

            await expect(cache.membership('u1', 't1', async () => null)).resolves.toBeNull();
        });

        it('does not let a failed load that settles late evict the fresh entry that replaced it', async () => {
            const cache = make();
            const old = deferred<string>();
            const first = cache.grants('u1', 't1', () => old.promise);

            cache.invalidateMember('u1', 't1');
            const fresh = jest.fn(async () => 'fresh');
            await cache.grants('u1', 't1', fresh);

            old.reject(new Error('late failure'));
            await expect(first).rejects.toThrow('late failure');
            await settle();

            await cache.grants('u1', 't1', fresh);
            expect(fresh).toHaveBeenCalledTimes(1);
        });
    });
});

describe('resolveAuthCacheTtlMs', () => {
    it('defaults to 30 seconds when unset or blank', () => {
        expect(resolveAuthCacheTtlMs(undefined)).toBe(AUTH_CACHE_DEFAULT_TTL_MS);
        expect(resolveAuthCacheTtlMs('  ')).toBe(AUTH_CACHE_DEFAULT_TTL_MS);
        expect(AUTH_CACHE_DEFAULT_TTL_MS).toBe(30_000);
    });

    it('takes a number of milliseconds, and 0 as off', () => {
        expect(resolveAuthCacheTtlMs('5000')).toBe(5000);
        expect(resolveAuthCacheTtlMs('0')).toBe(0);
    });

    it('ignores an unreadable value, says so, and keeps the default rather than switching off', () => {
        const logger = { warn: jest.fn() };

        expect(resolveAuthCacheTtlMs('off', logger)).toBe(AUTH_CACHE_DEFAULT_TTL_MS);
        expect(resolveAuthCacheTtlMs('-1', logger)).toBe(AUTH_CACHE_DEFAULT_TTL_MS);
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('is what the service reads from AUTH_CACHE_TTL_MS when no options are given', () => {
        const previous = process.env.AUTH_CACHE_TTL_MS;
        try {
            process.env.AUTH_CACHE_TTL_MS = '0';
            expect(new AuthCacheService().enabled).toBe(false);
            delete process.env.AUTH_CACHE_TTL_MS;
            expect(new AuthCacheService().ttlMs).toBe(30_000);
        } finally {
            if (previous === undefined) delete process.env.AUTH_CACHE_TTL_MS;
            else process.env.AUTH_CACHE_TTL_MS = previous;
        }
    });
});
