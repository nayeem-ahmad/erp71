import { syncSetupFeePaid, SETUP_FEE_EPOCH } from '../../../packages/database/prisma/sync-setup-fee-paid';

type Row = Record<string, any>;

/**
 * Minimal Prisma stand-in covering exactly what the sync calls: `findMany` and
 * `count` with a null-equality plus a `lt`/`gte` range on one field, and `update`.
 */
function fakePrisma(rows: Row[]) {
    const matches = (row: Row, where: Row = {}): boolean =>
        Object.entries(where).every(([key, cond]) => {
            if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
                if ('lt' in cond) return row[key] < (cond as any).lt;
                if ('gte' in cond) return row[key] >= (cond as any).gte;
            }
            return row[key] === cond;
        });

    return {
        rows,
        tenantSubscription: {
            findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
            count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
            update: async ({ where, data }: any) => {
                const row = rows.find((r) => r.id === where.id)!;
                Object.assign(row, data);
                return row;
            },
        },
    } as any;
}

const BEFORE = new Date('2026-08-01T00:00:00.000Z');
const AFTER = new Date('2026-09-07T10:00:00.000Z');

describe('syncSetupFeePaid', () => {
    it('stamps a subscription that predates the setup fee', async () => {
        // These are the legacy tenants the script exists for: onboarded long
        // before any fee existed, and billing them for one would be the single
        // most damaging thing the feature could do.
        const db = fakePrisma([{ id: 'old', current_period_start: BEFORE, setup_fee_paid_at: null }]);
        const result = await syncSetupFeePaid(db);

        expect(result.stamped).toBe(1);
        expect(db.rows[0].setup_fee_paid_at).toEqual(BEFORE);
    });

    it('never stamps a subscription created after the fee existed', async () => {
        // The regression this guards. Signup creates a PAST_DUE subscription with
        // no stamp and expects the customer to check out afterwards. This script
        // runs on every container start, so a deploy in that window used to stamp
        // the row -- and checkout then read it as "already paid" and silently
        // dropped a 15,000 BDT Business setup fee onto a correct-looking invoice.
        const db = fakePrisma([{ id: 'new', current_period_start: AFTER, setup_fee_paid_at: null }]);
        const result = await syncSetupFeePaid(db);

        expect(result.stamped).toBe(0);
        expect(db.rows[0].setup_fee_paid_at).toBeNull();
        // Counted and reported rather than absorbed: an unbilled fee should be
        // visible in the boot log, not silent.
        expect(result.skipped).toBe(1);
    });

    it('splits a mixed table on the epoch', async () => {
        const db = fakePrisma([
            { id: 'old', current_period_start: BEFORE, setup_fee_paid_at: null },
            { id: 'new', current_period_start: AFTER, setup_fee_paid_at: null },
            { id: 'done', current_period_start: BEFORE, setup_fee_paid_at: BEFORE },
        ]);
        const result = await syncSetupFeePaid(db);

        expect({ scanned: result.scanned, stamped: result.stamped, skipped: result.skipped })
            .toEqual({ scanned: 1, stamped: 1, skipped: 1 });
    });

    it('treats the epoch itself as owing a fee', async () => {
        // The boundary is `lt` on purpose: a subscription starting the instant the
        // fee landed is a real question for checkout, not one to assume away.
        const db = fakePrisma([{ id: 'edge', current_period_start: SETUP_FEE_EPOCH, setup_fee_paid_at: null }]);
        const result = await syncSetupFeePaid(db);

        expect(result.stamped).toBe(0);
        expect(db.rows[0].setup_fee_paid_at).toBeNull();
    });

    it('is idempotent and never overwrites a hand-corrected stamp', async () => {
        const corrected = new Date('2026-01-01T00:00:00.000Z');
        const db = fakePrisma([{ id: 'old', current_period_start: BEFORE, setup_fee_paid_at: corrected }]);

        await syncSetupFeePaid(db);
        const second = await syncSetupFeePaid(db);

        expect(second.stamped).toBe(0);
        expect(db.rows[0].setup_fee_paid_at).toEqual(corrected);
    });

    it('writes nothing on a dry run', async () => {
        const db = fakePrisma([{ id: 'old', current_period_start: BEFORE, setup_fee_paid_at: null }]);
        const result = await syncSetupFeePaid(db, true);

        expect(result.scanned).toBe(1);
        expect(result.stamped).toBe(0);
        expect(db.rows[0].setup_fee_paid_at).toBeNull();
    });
});
