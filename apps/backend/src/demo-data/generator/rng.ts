/**
 * Seeded pseudo-random number generator for the demo-data simulator.
 *
 * Determinism matters: a given (tenantId, batchNumber) always produces the same
 * dataset shape, so re-running against a fresh DB is reproducible, while a second
 * batch for the same tenant produces *different* data (a new load appends rather
 * than clones). We use mulberry32 — a small, fast, well-distributed 32-bit PRNG —
 * seeded from a string hash of tenantId + batchNumber.
 */

/** Deterministic 32-bit string hash (FNV-1a variant). */
export function hashSeed(input: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        // 32-bit FNV prime multiply, kept in 32-bit range via Math.imul
        h = Math.imul(h, 0x01000193);
    }
    // Force to unsigned 32-bit
    return h >>> 0;
}

/** mulberry32 PRNG. Returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function next(): number {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A small ergonomic wrapper over a raw PRNG with the sampling helpers the
 * simulator needs. All methods are pure functions of the internal state, so the
 * whole run is reproducible for a fixed seed.
 */
export class Rng {
    private readonly next: () => number;

    constructor(seed: number | string) {
        const numeric = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
        this.next = mulberry32(numeric);
    }

    static forTenant(tenantId: string, batchNumber: number): Rng {
        return new Rng(hashSeed(`${tenantId}:${batchNumber}`));
    }

    /** Float in [0, 1). */
    float(): number {
        return this.next();
    }

    /** Float in [min, max). */
    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    /** Integer in [min, max] inclusive. */
    int(min: number, max: number): number {
        return Math.floor(this.range(min, max + 1));
    }

    /** True with probability p (0..1). */
    chance(p: number): boolean {
        return this.next() < p;
    }

    /** Uniformly pick one element. */
    pick<T>(items: readonly T[]): T {
        return items[Math.floor(this.next() * items.length)];
    }

    /**
     * Weighted pick. `weights[i]` is the relative weight of `items[i]`.
     * Used for the sales mix so head products outsell the tail.
     */
    weighted<T>(items: readonly T[], weights: readonly number[]): T {
        const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
        if (total <= 0) return this.pick(items);
        let roll = this.next() * total;
        for (let i = 0; i < items.length; i++) {
            roll -= Math.max(0, weights[i]);
            if (roll <= 0) return items[i];
        }
        return items[items.length - 1];
    }

    /** Gaussian-ish noise around 1.0 via averaging (central limit), clamped >= 0. */
    noise(spread = 0.3): number {
        const avg = (this.next() + this.next() + this.next()) / 3; // ~N(0.5, small)
        return Math.max(0, 1 + (avg - 0.5) * 2 * spread);
    }

    /** In-place-free Fisher–Yates shuffle returning a new array. */
    shuffle<T>(items: readonly T[]): T[] {
        const out = items.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }
}
