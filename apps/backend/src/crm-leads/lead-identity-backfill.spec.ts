/**
 * Covers `planBackfill`, the pure decision half of
 * `packages/database/prisma/sync-lead-identity.ts`, so the rule that keeps the
 * oldest lead's claim on a contested identity value is tested without a live
 * database. The `main()` driver around it is exercised by running the script.
 *
 * This rule is load-bearing: the script runs inside the `&&` chain ahead of
 * `node main.js` in the container CMD, and a backfill that handed one value to
 * two leads would throw on the unique index and take the backend down with it.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const leadIdentitySync = require('../../../../packages/database/prisma/sync-lead-identity.ts');
/* eslint-enable @typescript-eslint/no-var-requires */

const { planBackfill } = leadIdentitySync as {
    planBackfill: (
        rows: any[],
        claimed: Set<string>,
    ) => { updates: { id: string; data: Record<string, string> }[]; collisions: number };
};

const lead = (over: Partial<Record<string, any>> = {}) => ({
    id: 'l1',
    tenant_id: 't1',
    mobile: null,
    email: null,
    linkedin_url: null,
    mobile_norm: null,
    email_norm: null,
    linkedin_norm: null,
    ...over,
});

describe('planBackfill', () => {
    it('derives the normalized keys a lead is missing', () => {
        const { updates } = planBackfill(
            [lead({ mobile: '01712-345678', email: ' Karim@Shop.com ' })],
            new Set(),
        );
        expect(updates).toEqual([
            { id: 'l1', data: { mobile_norm: '+8801712345678', email_norm: 'karim@shop.com' } },
        ]);
    });

    it('gives a contested value to the first lead only, and counts the rest', () => {
        // Rows arrive oldest-first, so the first row is the oldest lead.
        const { updates, collisions } = planBackfill(
            [
                lead({ id: 'old', mobile: '01712345678' }),
                lead({ id: 'newer', mobile: '+880 1712 345678' }),
            ],
            new Set(),
        );

        expect(updates).toEqual([{ id: 'old', data: { mobile_norm: '+8801712345678' } }]);
        expect(collisions).toBe(1);
    });

    it('leaves a lead unindexed rather than stealing a value already claimed', () => {
        // What a re-run sees: the older lead's column is already populated.
        const { updates, collisions } = planBackfill(
            [lead({ id: 'dup', mobile: '01712345678' })],
            new Set(['t1 mobile_norm +8801712345678']),
        );

        expect(updates).toEqual([]);
        expect(collisions).toBe(1);
    });

    it('never re-derives a column that is already set', () => {
        // An operator may have corrected a value by hand; the boot-time sync
        // must not quietly overwrite it.
        const { updates } = planBackfill(
            [lead({ mobile: '01712345678', mobile_norm: '+8809999999999' })],
            new Set(),
        );
        expect(updates).toEqual([]);
    });

    it('keeps tenants apart', () => {
        const { updates, collisions } = planBackfill(
            [
                lead({ id: 'a', tenant_id: 't1', mobile: '01712345678' }),
                lead({ id: 'b', tenant_id: 't2', mobile: '01712345678' }),
            ],
            new Set(),
        );

        expect(updates).toHaveLength(2);
        expect(collisions).toBe(0);
    });

    it('still fills the keys that are free when one key of a lead collides', () => {
        const { updates, collisions } = planBackfill(
            [lead({ mobile: '01712345678', email: 'free@shop.com' })],
            new Set(['t1 mobile_norm +8801712345678']),
        );

        expect(updates).toEqual([{ id: 'l1', data: { email_norm: 'free@shop.com' } }]);
        expect(collisions).toBe(1);
    });

    it('ignores a lead carrying no identity at all', () => {
        const { updates, collisions } = planBackfill([lead({ id: 'walk-in' })], new Set());
        expect(updates).toEqual([]);
        expect(collisions).toBe(0);
    });
});
