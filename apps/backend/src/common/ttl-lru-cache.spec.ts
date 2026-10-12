import { TtlLruCache } from './ttl-lru-cache';

describe('TtlLruCache', () => {
    let clock: number;
    const now = () => clock;

    beforeEach(() => {
        clock = 1_000_000;
    });

    it('returns what was stored until the time-to-live runs out', () => {
        const cache = new TtlLruCache<string>({ maxEntries: 10, ttlMs: 30_000, now });
        cache.set('a', 'one');

        clock += 29_999;
        expect(cache.get('a')).toBe('one');

        clock += 1;
        expect(cache.get('a')).toBeUndefined();
        // Read past its expiry, so it is gone rather than merely hidden.
        expect(cache.size).toBe(0);
    });

    it('restarts the time-to-live when a key is written again', () => {
        const cache = new TtlLruCache<string>({ maxEntries: 10, ttlMs: 1_000, now });
        cache.set('a', 'one');
        clock += 900;
        cache.set('a', 'two');
        clock += 900;

        expect(cache.get('a')).toBe('two');
    });

    it('does not extend an entry on read: the time-to-live counts from the write', () => {
        const cache = new TtlLruCache<string>({ maxEntries: 10, ttlMs: 1_000, now });
        cache.set('a', 'one');
        clock += 900;
        expect(cache.get('a')).toBe('one');
        clock += 100;

        expect(cache.get('a')).toBeUndefined();
    });

    it('evicts the least recently used entry beyond the cap', () => {
        const cache = new TtlLruCache<number>({ maxEntries: 3, ttlMs: 60_000, now });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        // Reading `a` makes `b` the oldest.
        expect(cache.get('a')).toBe(1);
        cache.set('d', 4);

        expect(cache.size).toBe(3);
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBe(1);
        expect(cache.get('c')).toBe(3);
        expect(cache.get('d')).toBe(4);
    });

    it('stores nothing with a zero time-to-live — the kill switch', () => {
        const cache = new TtlLruCache<string>({ maxEntries: 10, ttlMs: 0, now });
        cache.set('a', 'one');

        expect(cache.get('a')).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it('deletes one key', () => {
        const cache = new TtlLruCache<string>({ maxEntries: 10, ttlMs: 60_000, now });
        cache.set('a', 'one');
        cache.set('b', 'two');

        expect(cache.delete('a')).toBe(true);
        expect(cache.delete('a')).toBe(false);
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBe('two');
    });

    it('withdraws an entry only while it still holds the value given', () => {
        const cache = new TtlLruCache<object>({ maxEntries: 10, ttlMs: 60_000, now });
        const first = {};
        const second = {};
        cache.set('a', first);
        cache.set('a', second);

        expect(cache.deleteIfCurrent('a', first)).toBe(false);
        expect(cache.get('a')).toBe(second);
        expect(cache.deleteIfCurrent('a', second)).toBe(true);
        expect(cache.get('a')).toBeUndefined();
    });

    it('deletes every key a predicate matches, and only those', () => {
        const cache = new TtlLruCache<number>({ maxEntries: 10, ttlMs: 60_000, now });
        cache.set('membership:u1:t1', 1);
        cache.set('membership:u2:t1', 2);
        cache.set('membership:u1:t2', 3);

        expect(cache.deleteWhere((key) => key.endsWith(':t1'))).toBe(2);
        expect(cache.get('membership:u1:t1')).toBeUndefined();
        expect(cache.get('membership:u2:t1')).toBeUndefined();
        expect(cache.get('membership:u1:t2')).toBe(3);
    });

    it('clears everything', () => {
        const cache = new TtlLruCache<number>({ maxEntries: 10, ttlMs: 60_000, now });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.clear();

        expect(cache.size).toBe(0);
        expect(cache.get('a')).toBeUndefined();
    });
});
