import {
    planCodeRenames,
    planNameRenames,
    readableCode as scriptReadableCode,
} from '@erp71/database/prisma/fix-imported-codes.utils';
import { readableCode } from './external-sync.mapper';

/**
 * The plan behind `npm run fix:imported-codes`: what an already-imported
 * product, customer or supplier is renamed to, now that imports no longer
 * write GUIDs.
 */
describe('fix-imported-codes plan', () => {
    const GUID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
    const GUID2 = '9a0b1c2d-3e4f-4a6b-8c7d-5e6f7a8b9c0d';

    it('reads codes exactly as the import now does', () => {
        for (const code of ['P01212', ' C00564 ', '', GUID, '3f2a9c1e5b7d4e8f', '8901234567890123', 'ABCDEFGHIJKLMNOPQRSTU', 'EXT-1234']) {
            expect(scriptReadableCode(code)).toBe(readableCode(code));
        }
    });

    describe('planCodeRenames', () => {
        it('numbers EXT- and GUID codes after the highest in the series, and keeps readable ones', () => {
            const records = [
                { id: 'p1', externalId: GUID, value: `EXT-${GUID}` },
                { id: 'p2', externalId: '1234', value: 'EXT-1234' },
                { id: 'p3', externalId: '7', value: GUID2 },
                { id: 'p4', externalId: '8', value: 'P01212' },
            ];
            const held = new Set(['PRD-00003', 'PRD-0009x', ...records.map((r) => r.value)]);

            expect(planCodeRenames(records, held, 'PRD-')).toEqual([
                { id: 'p1', from: `EXT-${GUID}`, to: 'PRD-00004' },
                { id: 'p2', from: 'EXT-1234', to: 'PRD-00005' },
                { id: 'p3', from: GUID2, to: 'PRD-00006' },
            ]);
        });

        it("turns a repeat's added row id into -2, -3, … past any already taken", () => {
            const records = [
                { id: 'c1', externalId: '900', value: 'C00564' },
                { id: 'c2', externalId: '901', value: 'C00564-901' },
                { id: 'c3', externalId: GUID, value: `C00564-${GUID}` },
            ];
            const held = new Set(['C00564-2', ...records.map((r) => r.value)]);

            expect(planCodeRenames(records, held, 'CUST-')).toEqual([
                { id: 'c2', from: 'C00564-901', to: 'C00564-3' },
                { id: 'c3', from: `C00564-${GUID}`, to: 'C00564-4' },
            ]);
        });

        it("leaves a code that only looks like a repeat when nothing holds the part before the row id", () => {
            // The provider's own `P-100`, on row 100.
            const records = [{ id: 'p1', externalId: '100', value: 'P-100' }];

            expect(planCodeRenames(records, new Set(['P-100']), 'PRD-')).toEqual([]);
        });

        it("numbers a repeat whose first part is no code anyone would type", () => {
            const records = [
                { id: 'p1', externalId: '1', value: GUID },
                { id: 'p2', externalId: '2', value: `${GUID}-2` },
            ];

            expect(planCodeRenames(records, new Set(records.map((r) => r.value)), 'PRD-')).toEqual([
                { id: 'p1', from: GUID, to: 'PRD-00001' },
                { id: 'p2', from: `${GUID}-2`, to: 'PRD-00002' },
            ]);
        });
    });

    describe('planNameRenames', () => {
        it("turns a repeated supplier name's added row id into (2), (3), …", () => {
            const records = [
                { id: 's1', externalId: GUID, value: 'Acme' },
                { id: 's2', externalId: GUID2, value: `Acme-${GUID2}` },
                { id: 's3', externalId: '77', value: 'Acme-77' },
                // Its own name, not a repeat: no supplier is called "Bolt".
                { id: 's4', externalId: '12', value: 'Bolt-12' },
            ];
            const held = new Set(records.map((r) => r.value));

            expect(planNameRenames(records, held)).toEqual([
                { id: 's2', from: `Acme-${GUID2}`, to: 'Acme (2)' },
                { id: 's3', from: 'Acme-77', to: 'Acme (3)' },
            ]);
        });
    });
});
