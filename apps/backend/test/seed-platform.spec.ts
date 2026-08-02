import {
    addMissingKeys,
    seedPlatformReferenceData,
} from '../../../packages/database/prisma/seed-platform';

/**
 * `db:seed:platform` runs on EVERY production container start. It used to upsert
 * the version-controlled definition over the top of whatever was there, which
 * silently reverted every price, name and entitlement a platform admin had
 * edited — on every single deploy.
 */
describe('addMissingKeys', () => {
    it('adds a key the row does not have yet', () => {
        const { merged, added } = addMissingKeys({ maxUsers: 3 }, { maxUsers: 5, premiumProjects: true });
        expect(merged).toEqual({ maxUsers: 3, premiumProjects: true });
        expect(added).toEqual(['premiumProjects']);
    });

    it('never overwrites a key the admin has already set, even to a different value', () => {
        // maxUsers 3 vs the code's 5 is a decision, not drift.
        const { merged, added } = addMissingKeys({ maxUsers: 3 }, { maxUsers: 5 });
        expect(merged).toEqual({ maxUsers: 3 });
        expect(added).toEqual([]);
    });

    it('keeps a deliberately falsy value rather than treating it as absent', () => {
        const { merged } = addMissingKeys({ premiumCrm: false }, { premiumCrm: true });
        expect(merged.premiumCrm).toBe(false);
    });

    it('treats a null or non-object column as empty', () => {
        expect(addMissingKeys(null, { a: 1 }).merged).toEqual({ a: 1 });
        expect(addMissingKeys('nonsense', { a: 1 }).merged).toEqual({ a: 1 });
        expect(addMissingKeys([1, 2], { a: 1 }).merged).toEqual({ a: 1 });
    });
});

describe('seedPlatformReferenceData', () => {
    const plan = (over: Record<string, unknown> = {}) => ({
        code: 'STANDARD',
        name: 'Standard',
        monthly_price: 999,
        features_json: {},
        ...over,
    });

    function fakePrisma(existingPlans: Record<string, unknown> | null, existingAddons: unknown = null) {
        return {
            subscriptionPlan: {
                findUnique: jest.fn(({ where }: never) =>
                    Promise.resolve(existingPlans ? { ...plan(existingPlans), code: (where as never as { code: string }).code } : null),
                ),
                create: jest.fn(({ data }: never) => Promise.resolve(data)),
                update: jest.fn(({ data }: never) => Promise.resolve(data)),
            },
            addonModule: {
                findUnique: jest.fn(() => Promise.resolve(existingAddons)),
                create: jest.fn(({ data }: never) => Promise.resolve(data)),
                update: jest.fn(({ data }: never) => Promise.resolve(data)),
            },
        } as never;
    }

    it('creates the whole catalog on an empty database', async () => {
        const db = fakePrisma(null);
        await seedPlatformReferenceData(db);

        const created = (db as never as { subscriptionPlan: { create: jest.Mock } }).subscriptionPlan.create;
        expect(created).toHaveBeenCalled();
        const codes = created.mock.calls.map((c) => c[0].data.code);
        expect(codes).toEqual(expect.arrayContaining(['FREE', 'BASIC', 'ACCOUNTING', 'STANDARD', 'PREMIUM']));
    });

    it('never rewrites an existing plan’s price, name or active flag', async () => {
        // The exact regression: an admin had priced STANDARD at 1299 and the
        // next deploy quietly put it back to the number in this file.
        const db = fakePrisma({ monthly_price: 1299, name: 'Standard (BD)', is_active: false });
        await seedPlatformReferenceData(db);

        const updates = (db as never as { subscriptionPlan: { update: jest.Mock } }).subscriptionPlan.update;
        for (const call of updates.mock.calls) {
            expect(Object.keys(call[0].data)).toEqual(['features_json']);
        }
        expect((db as never as { subscriptionPlan: { create: jest.Mock } }).subscriptionPlan.create)
            .not.toHaveBeenCalled();
    });

    it('is a complete no-op once every entitlement key is present', async () => {
        // Second deploy in a row: nothing in code is new, so nothing is written.
        const full = await (async () => {
            const db = fakePrisma(null);
            await seedPlatformReferenceData(db);
            const create = (db as never as { subscriptionPlan: { create: jest.Mock } }).subscriptionPlan.create;
            return create.mock.calls.map((c) => c[0].data);
        })();

        const db = {
            subscriptionPlan: {
                findUnique: jest.fn(({ where }: never) =>
                    Promise.resolve(full.find((p) => p.code === (where as never as { code: string }).code) ?? null),
                ),
                create: jest.fn(),
                update: jest.fn(),
            },
            addonModule: { findUnique: jest.fn(() => Promise.resolve(null)), create: jest.fn(({ data }: never) => Promise.resolve(data)), update: jest.fn() },
        } as never;

        await seedPlatformReferenceData(db);

        expect((db as never as { subscriptionPlan: { update: jest.Mock } }).subscriptionPlan.update).not.toHaveBeenCalled();
        expect((db as never as { subscriptionPlan: { create: jest.Mock } }).subscriptionPlan.create).not.toHaveBeenCalled();
    });

    it('still carries a newly-coded entitlement onto an existing plan', async () => {
        // This is the reason the seed exists at all: a flag added in code has to
        // reach production without anyone hand-editing five rows.
        const db = fakePrisma({ features_json: { maxUsers: 3 } });
        await seedPlatformReferenceData(db);

        const updates = (db as never as { subscriptionPlan: { update: jest.Mock } }).subscriptionPlan.update;
        expect(updates).toHaveBeenCalled();
        const written = updates.mock.calls[0][0].data.features_json;
        expect(written.maxUsers).toBe(3); // the admin's value survived
        expect(Object.keys(written).length).toBeGreaterThan(1); // and code's new keys arrived
    });
});
