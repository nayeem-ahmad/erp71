/**
 * A bounded map whose entries expire.
 *
 * Written here rather than taken from `lru-cache` because the backend does not
 * depend on that package directly, and the two properties needed — a size cap
 * and a time-to-live — are a few lines on top of `Map`. A `Map` iterates in
 * insertion order, so re-inserting an entry on every hit keeps the least
 * recently used one first, and evicting from the front is LRU.
 *
 * Expired entries are dropped lazily, when they are read or pushed out by the
 * cap, rather than by a timer: a timer would keep the event loop busy for a
 * cache that is idle most of the night, and an entry nobody asks for again
 * costs nothing but its slot.
 */
export interface TtlLruCacheOptions {
    /** Entries beyond this many push out the least recently used. */
    maxEntries: number;
    /** How long an entry is served after it was written. `0` stores nothing. */
    ttlMs: number;
    /** Injectable clock, for tests. */
    now?: () => number;
}

interface Entry<V> {
    value: V;
    expiresAt: number;
}

export class TtlLruCache<V> {
    private readonly entries = new Map<string, Entry<V>>();
    private readonly now: () => number;

    constructor(private readonly options: TtlLruCacheOptions) {
        this.now = options.now ?? Date.now;
    }

    /** Live and expired entries alike, until a read or the cap removes the latter. */
    get size(): number {
        return this.entries.size;
    }

    get(key: string): V | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;

        if (entry.expiresAt <= this.now()) {
            this.entries.delete(key);
            return undefined;
        }

        // Most recently used goes to the back, so eviction takes the front.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key: string, value: V): void {
        if (this.options.ttlMs <= 0 || this.options.maxEntries <= 0) return;

        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });

        while (this.entries.size > this.options.maxEntries) {
            const oldest = this.entries.keys().next();
            if (oldest.done) break;
            this.entries.delete(oldest.value);
        }
    }

    delete(key: string): boolean {
        return this.entries.delete(key);
    }

    /**
     * Removes `key` only while it still holds `value`. For a writer that must
     * not clobber a newer entry put there after its own — a failed load
     * withdrawing itself, say, after an invalidation and a fresh load have
     * already replaced it.
     */
    deleteIfCurrent(key: string, value: V): boolean {
        const entry = this.entries.get(key);
        if (!entry || entry.value !== value) return false;
        return this.entries.delete(key);
    }

    /** Removes every entry whose key matches. Returns how many went. */
    deleteWhere(match: (key: string) => boolean): number {
        let removed = 0;
        // Collected first: deleting from a Map while iterating it is defined in
        // JavaScript, but reads as a bug to anyone who has met other languages.
        const doomed = [...this.entries.keys()].filter(match);
        for (const key of doomed) {
            if (this.entries.delete(key)) removed += 1;
        }
        return removed;
    }

    clear(): void {
        this.entries.clear();
    }
}
