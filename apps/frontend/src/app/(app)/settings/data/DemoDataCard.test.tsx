import { getCompletedLoads, summariseCounts, OPTIONAL_MODULES, type DemoBatch } from './DemoDataCard';

const batch = (overrides: Partial<DemoBatch>): DemoBatch => ({
    status: 'COMPLETED',
    processed: 180,
    total: 180,
    batch_number: 1,
    ...overrides,
});

describe('getCompletedLoads', () => {
    it('counts nothing before the first load', () => {
        expect(getCompletedLoads(null)).toBe(0);
    });

    it('counts a completed batch', () => {
        expect(getCompletedLoads(batch({ batch_number: 3 }))).toBe(3);
    });

    it('does not count the batch currently running', () => {
        // Batch 3 in flight means two loads have actually finished — the button
        // should still read "add more", but the count must not include this one.
        expect(getCompletedLoads(batch({ batch_number: 3, status: 'RUNNING' }))).toBe(2);
        expect(getCompletedLoads(batch({ batch_number: 1, status: 'PENDING' }))).toBe(0);
        expect(getCompletedLoads(batch({ batch_number: 2, status: 'FAILED' }))).toBe(1);
    });
});

describe('summariseCounts', () => {
    it('returns nothing when the batch reported no counts', () => {
        expect(summariseCounts(null)).toEqual([]);
        expect(summariseCounts(undefined)).toEqual([]);
        expect(summariseCounts({})).toEqual([]);
    });

    it('rolls counts up into the module group they belong to', () => {
        const rows = summariseCounts({ sales: 100, purchases: 20, leads: 7, crmContacts: 3 });
        expect(rows).toEqual([
            { group: 'core', total: 120 },
            { group: 'crm', total: 10 },
        ]);
    });

    it('leaves out groups the batch did not populate', () => {
        // A batch loaded with only CRM selected should show one row, not eight
        // rows of zero.
        const rows = summariseCounts({ sales: 5, leads: 2 });
        expect(rows.map((row) => row.group)).toEqual(['core', 'crm']);
    });

    it('covers every optional module group', () => {
        // Each checkbox on the form must have somewhere for its rows to land,
        // otherwise a module could generate data that the summary never shows.
        const counts: Record<string, number> = {
            quotations: 1, purchaseOrders: 1, transfers: 1, leads: 1,
            employees: 1, fixedAssets: 1, projects: 1,
        };
        const groups = summariseCounts(counts).map((row) => row.group);
        for (const optionalGroup of OPTIONAL_MODULES) {
            expect(groups).toContain(optionalGroup);
        }
    });
});
