import { buildFunnel } from './funnel-model';

/**
 * The funnel is the one chart doing arithmetic rather than just plotting given
 * numbers, so the stage rules and the divide-by-zero case are pinned here rather
 * than left to a rendering test to notice.
 */
describe('buildFunnel', () => {
    it('returns four stages in descending funnel order', () => {
        const stages = buildFunnel({ clicks: 100, signups: 10, earned: 4, paid: 2 });

        expect(stages.map((s) => s.key)).toEqual(['clicks', 'signups', 'earned', 'paid']);
        expect(stages.map((s) => s.value)).toEqual([100, 10, 4, 2]);
    });

    it('computes drop-off against the previous stage, with none on the first', () => {
        const stages = buildFunnel({ clicks: 100, signups: 10, earned: 4, paid: 2 });

        expect(stages[0].dropOffPct).toBeNull();
        expect(stages[1].dropOffPct).toBe(90);
        expect(stages[2].dropOffPct).toBe(60);
        expect(stages[3].dropOffPct).toBe(50);
    });

    it('returns null drop-off rather than NaN when the previous stage is zero', () => {
        const stages = buildFunnel({ clicks: 0, signups: 0, earned: 0, paid: 0 });

        expect(stages.every((s) => s.dropOffPct === null)).toBe(true);
        expect(stages.some((s) => Number.isNaN(s.dropOffPct as number))).toBe(false);
    });

    it('never reports a negative drop-off when a later stage exceeds its predecessor', () => {
        // Possible when clicks predate click tracking but the signups they produced
        // are still on the ledger. Clamp rather than print "-200% drop-off".
        const stages = buildFunnel({ clicks: 1, signups: 3, earned: 3, paid: 0 });

        expect(stages[1].dropOffPct).toBe(0);
    });

    it('rounds drop-off to a whole percent', () => {
        const stages = buildFunnel({ clicks: 3, signups: 1, earned: 0, paid: 0 });

        expect(stages[1].dropOffPct).toBe(67);
    });
});
