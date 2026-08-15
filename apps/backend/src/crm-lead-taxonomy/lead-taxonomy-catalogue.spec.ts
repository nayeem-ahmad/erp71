/**
 * Drift guard for the two copies of the lead-taxonomy catalogue.
 *
 * packages/database/package.json sets `main: ./index.js` and `types: ./index.ts`.
 * The backend type-checks against the `.ts` but *loads* the hand-maintained
 * CommonJS mirror at runtime, so a symbol added to one and not the other
 * compiles clean and then throws "is not a function" in production. That is
 * exactly what happened while building this feature — every tenant signup would
 * have failed on `seedDefaultLeadTaxonomy is not a function`. This test is what
 * catches it next time.
 */
// Both sides are `require`d with explicit paths on purpose. jest's
// moduleFileExtensions resolves `js` before `ts`, so an extensionless import of
// the source would silently load the mirror and compare it against itself; and a
// static `import ... from '....ts'` trips TS5097. A require path is a plain
// string to the compiler and an exact file to jest.
/* eslint-disable @typescript-eslint/no-var-requires */
const source = require('../../../../packages/database/prisma/lead-taxonomy.seed.ts');
// The package entry point the backend's own imports resolve to.
const pkg = require('@erp71/database');
/* eslint-enable @typescript-eslint/no-var-requires */

const {
    DEFAULT_ACTIVITY_PURPOSES,
    DEFAULT_CONVERSATION_CHANNELS,
    DEFAULT_LEAD_CATEGORIES,
    DEFAULT_LEAD_SOURCES,
    FALLBACK_SOURCE_CODE,
    LEGACY_LEAD_CATEGORY_CODES,
    LEGACY_LEAD_SOURCE_CODES,
} = source as {
    DEFAULT_ACTIVITY_PURPOSES: { code: string; name: string; icon: string; sort_order: number }[];
    DEFAULT_CONVERSATION_CHANNELS: { code: string; name: string; icon: string; sort_order: number }[];
    DEFAULT_LEAD_CATEGORIES: { code: string; name: string; sort_order: number }[];
    DEFAULT_LEAD_SOURCES: { code: string; name: string; score_weight: number; sort_order: number }[];
    FALLBACK_SOURCE_CODE: string;
    LEGACY_LEAD_CATEGORY_CODES: readonly string[];
    LEGACY_LEAD_SOURCE_CODES: readonly string[];
};

/** The members of the `LeadConversationType` enum the channel list replaced. */
const LEGACY_CONVERSATION_TYPES = [
    'CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'VISIT', 'ONLINE_MEETING', 'NOTE',
];

describe('lead taxonomy catalogue', () => {
    it('reaches the backend through the package entry point', () => {
        // Guards both halves of the bug: a missing mirror file, and a mirror
        // that exists but was never wired into index.js.
        expect(typeof pkg.seedDefaultLeadTaxonomy).toBe('function');
        expect(pkg.FALLBACK_SOURCE_CODE).toBe(FALLBACK_SOURCE_CODE);
    });

    it('keeps the runtime mirror identical to the TypeScript source', () => {
        expect(pkg.DEFAULT_LEAD_SOURCES).toEqual(DEFAULT_LEAD_SOURCES);
        expect(pkg.DEFAULT_LEAD_CATEGORIES).toEqual(DEFAULT_LEAD_CATEGORIES);
        expect(pkg.DEFAULT_CONVERSATION_CHANNELS).toEqual(DEFAULT_CONVERSATION_CHANNELS);
        expect(pkg.LEGACY_LEAD_SOURCE_CODES).toEqual([...LEGACY_LEAD_SOURCE_CODES]);
        expect(pkg.LEGACY_LEAD_CATEGORY_CODES).toEqual([...LEGACY_LEAD_CATEGORY_CODES]);
    });

    it('ships a row for every legacy enum member, so the backfill cannot orphan a lead', () => {
        const sourceCodes = DEFAULT_LEAD_SOURCES.map((s) => s.code);
        for (const code of LEGACY_LEAD_SOURCE_CODES) {
            expect(sourceCodes).toContain(code);
        }
        const categoryCodes = DEFAULT_LEAD_CATEGORIES.map((c) => c.code);
        for (const code of LEGACY_LEAD_CATEGORY_CODES) {
            expect(categoryCodes).toContain(code);
        }
    });

    it('carries over the legacy score weights verbatim so no lead is rescored on migration day', () => {
        const weightFor = (code: string) =>
            DEFAULT_LEAD_SOURCES.find((s) => s.code === code)?.score_weight;

        // The values from the SOURCE_WEIGHT map this table replaces.
        expect(weightFor('REFERRAL')).toBe(25);
        expect(weightFor('WEBSITE')).toBe(20);
        expect(weightFor('FACEBOOK')).toBe(15);
        expect(weightFor('WALK_IN')).toBe(15);
        expect(weightFor('PHONE')).toBe(10);
        expect(weightFor('OTHER')).toBe(5);
    });

    it('guarantees the fallback source exists', () => {
        expect(DEFAULT_LEAD_SOURCES.some((s) => s.code === FALLBACK_SOURCE_CODE)).toBe(true);
    });

    it('ships a channel for every value the old enum allowed, so no logged conversation is orphaned', () => {
        const channelCodes = DEFAULT_CONVERSATION_CHANNELS.map((c) => c.code);
        for (const code of LEGACY_CONVERSATION_TYPES) {
            expect(channelCodes).toContain(code);
        }
    });

    it('has unique codes and names within each list', () => {
        for (const list of [
            DEFAULT_LEAD_SOURCES,
            DEFAULT_LEAD_CATEGORIES,
            DEFAULT_CONVERSATION_CHANNELS,
            DEFAULT_ACTIVITY_PURPOSES,
        ]) {
            const codes = list.map((r) => r.code);
            const names = list.map((r) => r.name.toLowerCase());
            expect(new Set(codes).size).toBe(codes.length);
            expect(new Set(names).size).toBe(names.length);
        }
    });
});

describe('activity purpose catalogue', () => {
    it('seeds the four codes CrmFollowUp.type carries today', () => {
        expect(DEFAULT_ACTIVITY_PURPOSES.map((p) => p.code).sort()).toEqual([
            'BIRTHDAY',
            'COLLECTION',
            'GENERAL',
            'REORDER_REMINDER',
        ]);
    });

    // The .ts is typechecked and the .js is what actually loads at runtime —
    // a .ts-only edit compiles clean and is undefined in production.
    it('keeps the .ts and .js mirrors in step', () => {
        expect(pkg.DEFAULT_ACTIVITY_PURPOSES).toEqual(DEFAULT_ACTIVITY_PURPOSES);
    });
});
