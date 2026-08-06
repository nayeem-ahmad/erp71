import {
    computeStructure,
    money,
    structureInForce,
    type ComponentDef,
} from './salary-structure.util';

const component = (over: Partial<ComponentDef> & { id: string; name: string }): ComponentDef => ({
    kind: 'EARNING',
    calculation: 'FIXED',
    is_basic: false,
    is_taxable: true,
    sort_order: 0,
    ...over,
});

/** The standard Bangladeshi split. */
const COMPONENTS: ComponentDef[] = [
    component({ id: 'c-basic', name: 'Basic', is_basic: true, sort_order: 0 }),
    component({ id: 'c-house', name: 'House Rent', calculation: 'PERCENT_OF_BASIC', sort_order: 1 }),
    component({ id: 'c-med', name: 'Medical', calculation: 'PERCENT_OF_BASIC', is_taxable: false, sort_order: 2 }),
    component({ id: 'c-conv', name: 'Conveyance', sort_order: 3 }),
    component({ id: 'c-pf', name: 'Provident Fund', kind: 'DEDUCTION', calculation: 'PERCENT_OF_BASIC', is_taxable: false, sort_order: 10 }),
];

describe('salary-structure.util', () => {
    describe('money', () => {
        it('rounds to two places the way money rounds', () => {
            expect(money(1234.567)).toBe(1234.57);
            expect(money(0.005)).toBe(0.01);
        });

        it('does not leave float dust', () => {
            expect(money(0.1 + 0.2)).toBe(0.3);
        });
    });

    describe('computeStructure', () => {
        const LINES = [
            { component_id: 'c-basic', value: 20000 },
            { component_id: 'c-house', value: 50 },
            { component_id: 'c-med', value: 10 },
            { component_id: 'c-conv', value: 1500 },
            { component_id: 'c-pf', value: 5 },
        ];

        it('resolves percentages against the basic line', () => {
            const result = computeStructure(COMPONENTS, LINES);
            expect(result.basic).toBe(20000);
            expect(result.earnings.find((l) => l.name === 'House Rent')?.amount).toBe(10000);
            expect(result.earnings.find((l) => l.name === 'Medical')?.amount).toBe(2000);
        });

        it('keeps a fixed line at its taka value', () => {
            const result = computeStructure(COMPONENTS, LINES);
            expect(result.earnings.find((l) => l.name === 'Conveyance')?.amount).toBe(1500);
        });

        it('sums gross earnings, deductions and net', () => {
            const result = computeStructure(COMPONENTS, LINES);
            expect(result.grossEarnings).toBe(33500); // 20000 + 10000 + 2000 + 1500
            expect(result.totalDeductions).toBe(1000); // 5% of 20000
            expect(result.net).toBe(32500);
        });

        it('excludes non-taxable earnings from taxable income', () => {
            const result = computeStructure(COMPONENTS, LINES);
            // Medical is is_taxable: false here.
            expect(result.taxableEarnings).toBe(31500);
        });

        it('separates earnings from deductions', () => {
            const result = computeStructure(COMPONENTS, LINES);
            expect(result.earnings.map((l) => l.name)).not.toContain('Provident Fund');
            expect(result.deductions.map((l) => l.name)).toEqual(['Provident Fund']);
        });

        it('orders lines by the component sort order', () => {
            const shuffled = [...LINES].reverse();
            const result = computeStructure(COMPONENTS, shuffled);
            expect(result.earnings.map((l) => l.name)).toEqual(['Basic', 'House Rent', 'Medical', 'Conveyance']);
        });

        it('computes everything to zero when there is no basic line', () => {
            // Documents the failure mode the service refuses to let happen: a
            // structure without basic looks complete and pays almost nothing.
            const result = computeStructure(COMPONENTS, [
                { component_id: 'c-house', value: 50 },
                { component_id: 'c-conv', value: 1500 },
            ]);
            expect(result.basic).toBe(0);
            expect(result.earnings.find((l) => l.name === 'House Rent')?.amount).toBe(0);
            expect(result.grossEarnings).toBe(1500);
        });

        it('skips a line whose component has been deleted', () => {
            // A structure written last year must still compute after somebody
            // tidies the component list — dropping one line beats refusing to
            // pay anybody.
            const result = computeStructure(COMPONENTS, [
                ...LINES,
                { component_id: 'c-gone', value: 999 },
            ]);
            expect(result.grossEarnings).toBe(33500);
        });

        it('handles an empty structure without throwing', () => {
            const result = computeStructure(COMPONENTS, []);
            expect(result.net).toBe(0);
            expect(result.earnings).toEqual([]);
        });

        it('rounds each line before summing, not after', () => {
            // 33.33% of 10000 is 3333.00; summing unrounded would drift.
            const result = computeStructure(COMPONENTS, [
                { component_id: 'c-basic', value: 10000 },
                { component_id: 'c-house', value: 33.33 },
            ]);
            expect(result.earnings.find((l) => l.name === 'House Rent')?.amount).toBe(3333);
            expect(result.grossEarnings).toBe(13333);
        });

        it('reports the configured rate alongside the computed amount', () => {
            // The payslip needs to say "50% of basic", not just the taka.
            const result = computeStructure(COMPONENTS, LINES);
            const house = result.earnings.find((l) => l.name === 'House Rent');
            expect(house?.rate).toBe(50);
            expect(house?.calculation).toBe('PERCENT_OF_BASIC');
        });
    });

    describe('structureInForce', () => {
        const d = (iso: string) => new Date(iso);
        const structures = [
            { effective_from: d('2026-07-01'), id: 'raise' },
            { effective_from: d('2026-01-01'), id: 'original' },
        ];

        it('picks the current structure', () => {
            expect(structureInForce(structures, d('2026-08-01'))?.id).toBe('raise');
        });

        it('picks the structure in force in a past month', () => {
            // Recomputing March must use March's pay, or a payroll rerun
            // silently changes history.
            expect(structureInForce(structures, d('2026-03-01'))?.id).toBe('original');
        });

        it('includes a structure effective exactly on the date', () => {
            expect(structureInForce(structures, d('2026-07-01'))?.id).toBe('raise');
        });

        it('returns null before the first structure', () => {
            expect(structureInForce(structures, d('2025-01-01'))).toBeNull();
        });
    });
});
