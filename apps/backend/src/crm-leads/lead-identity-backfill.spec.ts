/**
 * Covers `planBackfill`, the pure decision half of
 * `packages/database/prisma/sync-lead-identity.ts`. The unique indexes are
 * gone, so a shared mobile, email, or LinkedIn value is written onto every
 * lead whose norm is still null. Leaving it null would hide an email the user
 * can already see. The `main()` driver around it is exercised by running the
 * script.
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

/** Display columns stay out of every update. The script may write only norms. */
const expectNormsOnly = (updates: { data: Record<string, string> }[]) => {
    for (const update of updates) {
        expect(update.data).not.toHaveProperty('email');
        expect(update.data).not.toHaveProperty('mobile');
        expect(update.data).not.toHaveProperty('linkedin_url');
    }
};

describe('planBackfill', () => {
    it('derives the normalized keys a lead is missing', () => {
        const { updates } = planBackfill(
            [lead({ mobile: '01712-345678', email: ' Karim@Shop.com ' })],
            new Set(),
        );
        expect(updates).toEqual([
            { id: 'l1', data: { mobile_norm: '+8801712345678', email_norm: 'karim@shop.com' } },
        ]);
        expectNormsOnly(updates);
    });

    it('fills a shared email on every lead whose email_norm is still null', () => {
        // `claimed` already holds the address, the way a re-run used to see an
        // older lead. That must not leave the later lead's norm null.
        const { updates, collisions } = planBackfill(
            [
                lead({ id: 'old', email: 'Info@Shop.com' }),
                lead({ id: 'newer', email: ' info@shop.com ' }),
                lead({ id: 'already', email: 'info@shop.com', email_norm: 'kept@shop.com' }),
            ],
            new Set(['t1 email_norm info@shop.com']),
        );

        expect(updates).toEqual([
            { id: 'old', data: { email_norm: 'info@shop.com' } },
            { id: 'newer', data: { email_norm: 'info@shop.com' } },
        ]);
        expect(collisions).toBe(0);
        expectNormsOnly(updates);
    });

    it('fills a shared mobile on every lead whose mobile_norm is still null', () => {
        const { updates, collisions } = planBackfill(
            [
                lead({ id: 'old', mobile: '01712345678' }),
                lead({ id: 'newer', mobile: '+880 1712 345678' }),
            ],
            new Set(['t1 mobile_norm +8801712345678']),
        );

        expect(updates).toEqual([
            { id: 'old', data: { mobile_norm: '+8801712345678' } },
            { id: 'newer', data: { mobile_norm: '+8801712345678' } },
        ]);
        expect(collisions).toBe(0);
        expectNormsOnly(updates);
    });

    it('fills a shared LinkedIn profile on every lead whose linkedin_norm is still null', () => {
        const { updates, collisions } = planBackfill(
            [
                lead({ id: 'old', linkedin_url: 'https://www.LinkedIn.com/in/Jane-Doe/' }),
                lead({ id: 'newer', linkedin_url: 'linkedin.com/in/jane-doe' }),
            ],
            new Set(['t1 linkedin_norm linkedin.com/in/jane-doe']),
        );

        expect(updates).toEqual([
            { id: 'old', data: { linkedin_norm: 'linkedin.com/in/jane-doe' } },
            { id: 'newer', data: { linkedin_norm: 'linkedin.com/in/jane-doe' } },
        ]);
        expect(collisions).toBe(0);
        expectNormsOnly(updates);
    });

    it('does not update a lead whose email_norm is already set', () => {
        const { updates } = planBackfill(
            [lead({ email: 'info@shop.com', email_norm: 'kept@shop.com' })],
            new Set(),
        );
        expect(updates).toEqual([]);
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
        expectNormsOnly(updates);
    });

    it('fills a claimed mobile and a free email on the same lead', () => {
        const { updates, collisions } = planBackfill(
            [lead({ mobile: '01712345678', email: 'free@shop.com' })],
            new Set(['t1 mobile_norm +8801712345678']),
        );

        expect(updates).toEqual([
            {
                id: 'l1',
                data: { mobile_norm: '+8801712345678', email_norm: 'free@shop.com' },
            },
        ]);
        expect(collisions).toBe(0);
        expectNormsOnly(updates);
    });

    it('ignores a lead carrying no identity at all', () => {
        const { updates, collisions } = planBackfill([lead({ id: 'walk-in' })], new Set());
        expect(updates).toEqual([]);
        expect(collisions).toBe(0);
    });
});
