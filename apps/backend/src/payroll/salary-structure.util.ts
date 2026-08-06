/**
 * Turning a salary structure into a gross figure.
 *
 * Pure functions with no database, so the payroll run (Phase 6) and the
 * structure editor can agree on what a structure is worth without either owning
 * the arithmetic.
 */

export type ComponentKind = 'EARNING' | 'DEDUCTION';
export type Calculation = 'FIXED' | 'PERCENT_OF_BASIC';

export interface ComponentDef {
    id: string;
    name: string;
    kind: ComponentKind;
    calculation: Calculation;
    is_basic: boolean;
    is_taxable: boolean;
    sort_order: number;
}

export interface StructureLine {
    component_id: string;
    value: number;
}

export interface ComputedLine {
    component_id: string;
    name: string;
    kind: ComponentKind;
    is_taxable: boolean;
    /** What was configured — a taka amount or a percentage. */
    rate: number;
    calculation: Calculation;
    /** The taka figure this line contributes. */
    amount: number;
}

export interface ComputedStructure {
    basic: number;
    earnings: ComputedLine[];
    deductions: ComputedLine[];
    grossEarnings: number;
    totalDeductions: number;
    /** Gross minus deductions, before anything attendance- or tax-related. */
    net: number;
    taxableEarnings: number;
}

/** Round to 2dp the way money is rounded, not the way floats are. */
export function money(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Compute a structure.
 *
 * The basic line is resolved first and always FIXED — a percentage of itself is
 * not a definition, and allowing it would make the whole structure circular.
 * Every other line may reference it.
 */
export function computeStructure(
    components: ComponentDef[],
    lines: StructureLine[],
): ComputedStructure {
    const byId = new Map(components.map((component) => [component.id, component]));
    const basicComponent = components.find((component) => component.is_basic);

    const basicLine = basicComponent
        ? lines.find((line) => line.component_id === basicComponent.id)
        : undefined;
    const basic = money(basicLine?.value ?? 0);

    const computed: ComputedLine[] = [];
    for (const line of lines) {
        const component = byId.get(line.component_id);
        // A line whose component was deleted is skipped rather than throwing:
        // a structure written last year must still compute after somebody
        // tidies the component list, and silently dropping one line is far
        // better than refusing to pay anybody.
        if (!component) continue;

        const amount = component.is_basic
            ? basic
            : component.calculation === 'PERCENT_OF_BASIC'
                ? money((basic * Number(line.value)) / 100)
                : money(Number(line.value));

        computed.push({
            component_id: component.id,
            name: component.name,
            kind: component.kind,
            is_taxable: component.is_taxable,
            rate: Number(line.value),
            calculation: component.calculation,
            amount,
        });
    }

    computed.sort((a, b) => {
        const orderA = byId.get(a.component_id)?.sort_order ?? 0;
        const orderB = byId.get(b.component_id)?.sort_order ?? 0;
        return orderA - orderB;
    });

    const earnings = computed.filter((line) => line.kind === 'EARNING');
    const deductions = computed.filter((line) => line.kind === 'DEDUCTION');

    const grossEarnings = money(earnings.reduce((sum, line) => sum + line.amount, 0));
    const totalDeductions = money(deductions.reduce((sum, line) => sum + line.amount, 0));
    const taxableEarnings = money(
        earnings.filter((line) => line.is_taxable).reduce((sum, line) => sum + line.amount, 0),
    );

    return {
        basic,
        earnings,
        deductions,
        grossEarnings,
        totalDeductions,
        net: money(grossEarnings - totalDeductions),
        taxableEarnings,
    };
}

/**
 * Pick the structure in force on a date, newest effective date not in the
 * future. Same shape and same reasoning as `scheduleInForce`.
 */
export function structureInForce<T extends { effective_from: Date }>(
    structures: T[],
    date: Date,
): T | null {
    for (const structure of structures) {
        if (structure.effective_from <= date) return structure;
    }
    return null;
}

/**
 * The standard Bangladeshi salary split, seeded for a new tenant.
 *
 * These percentages are the common private-sector convention, not a legal
 * requirement — a tenant is expected to edit them. They exist so the structure
 * screen opens with something recognisable rather than blank.
 */
export const DEFAULT_COMPONENTS: Omit<ComponentDef, 'id'>[] = [
    { name: 'Basic', kind: 'EARNING', calculation: 'FIXED', is_basic: true, is_taxable: true, sort_order: 0 },
    { name: 'House Rent', kind: 'EARNING', calculation: 'PERCENT_OF_BASIC', is_basic: false, is_taxable: true, sort_order: 1 },
    { name: 'Medical Allowance', kind: 'EARNING', calculation: 'PERCENT_OF_BASIC', is_basic: false, is_taxable: true, sort_order: 2 },
    { name: 'Conveyance', kind: 'EARNING', calculation: 'FIXED', is_basic: false, is_taxable: true, sort_order: 3 },
    { name: 'Provident Fund', kind: 'DEDUCTION', calculation: 'PERCENT_OF_BASIC', is_basic: false, is_taxable: false, sort_order: 10 },
];

/** The default rates that go with `DEFAULT_COMPONENTS`, by component name. */
export const DEFAULT_RATES: Record<string, number> = {
    'House Rent': 50,
    'Medical Allowance': 10,
    'Conveyance': 0,
    'Provident Fund': 0,
};
