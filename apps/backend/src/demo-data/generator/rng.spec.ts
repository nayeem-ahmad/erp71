import { Rng, hashSeed, mulberry32 } from './rng';

describe('demo-data RNG', () => {
    it('hashSeed is deterministic and unsigned 32-bit', () => {
        expect(hashSeed('abc')).toBe(hashSeed('abc'));
        expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
        expect(hashSeed('anything')).toBeGreaterThanOrEqual(0);
        expect(hashSeed('anything')).toBeLessThan(2 ** 32);
    });

    it('mulberry32 yields the same sequence for the same seed', () => {
        const a = mulberry32(12345);
        const b = mulberry32(12345);
        const seqA = Array.from({ length: 5 }, () => a());
        const seqB = Array.from({ length: 5 }, () => b());
        expect(seqA).toEqual(seqB);
        for (const v of seqA) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('same (tenant, batch) produces an identical stream; a new batch differs', () => {
        const draw = (rng: Rng) => Array.from({ length: 10 }, () => rng.int(0, 1000));
        const batch1a = draw(Rng.forTenant('tenant-1', 1));
        const batch1b = draw(Rng.forTenant('tenant-1', 1));
        const batch2 = draw(Rng.forTenant('tenant-1', 2));

        expect(batch1a).toEqual(batch1b); // reproducible
        expect(batch1a).not.toEqual(batch2); // a second load is not a clone
    });

    it('int() stays within the inclusive range', () => {
        const rng = new Rng('range-test');
        for (let i = 0; i < 1000; i++) {
            const v = rng.int(3, 7);
            expect(v).toBeGreaterThanOrEqual(3);
            expect(v).toBeLessThanOrEqual(7);
        }
    });

    it('weighted() never picks a zero-weight item when a positive one exists', () => {
        const rng = new Rng('weighted-test');
        const items = ['never', 'always'] as const;
        const weights = [0, 1];
        for (let i = 0; i < 200; i++) {
            expect(rng.weighted(items, weights)).toBe('always');
        }
    });

    it('pick() always returns an element of the array', () => {
        const rng = new Rng('pick-test');
        const items = ['a', 'b', 'c'];
        for (let i = 0; i < 200; i++) {
            expect(items).toContain(rng.pick(items));
        }
    });
});
