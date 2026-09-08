/**
 * What a demo-data load was asked to produce.
 *
 * The first load is meant to be one click — every default here produces the full
 * six-month, every-module, anomalies-included dataset. The options exist for the
 * *second* load: once a store already has history, an operator usually wants to
 * top it up with something specific (another quarter of trading, or only the CRM
 * and HR modules for a pipeline demo) rather than a duplicate of the first run.
 */

/** Module groups an operator can include or leave out of a batch. */
export const DEMO_MODULE_GROUPS = ['core', 'sales', 'purchasing', 'inventory', 'crm', 'hr', 'finance', 'operations'] as const;

export type DemoModuleGroup = (typeof DEMO_MODULE_GROUPS)[number];

/**
 * `core` is not selectable — the products, parties, opening stock and daily
 * sales that everything else hangs off are always generated. Listing it in
 * `modules` is harmless; omitting it does not switch it off.
 */
export const OPTIONAL_MODULE_GROUPS: readonly DemoModuleGroup[] = DEMO_MODULE_GROUPS.filter((m) => m !== 'core');

export interface DemoDataOptions {
    /** Months of history to simulate, counting back from today. */
    months: number;
    /** Module groups to populate. `core` is always on. */
    modules: DemoModuleGroup[];
    /** Plant detectable oddities in the trading data (see `anomalies.ts`). */
    includeAnomalies: boolean;
}

export const MIN_DEMO_MONTHS = 1;
export const MAX_DEMO_MONTHS = 12;
export const DEFAULT_DEMO_MONTHS = 6;

export const DEFAULT_DEMO_OPTIONS: DemoDataOptions = {
    months: DEFAULT_DEMO_MONTHS,
    modules: [...DEMO_MODULE_GROUPS],
    includeAnomalies: true,
};

/** Raw, unvalidated options as they arrive from the HTTP layer. */
export interface DemoDataOptionsInput {
    months?: number | string | null;
    modules?: string[] | null;
    includeAnomalies?: boolean | null;
}

/**
 * Clamp and normalise caller-supplied options. Anything missing or unusable
 * falls back to the full-dataset default rather than failing the request — a
 * demo load is not a place to argue with the operator over a bad month count.
 */
export function resolveDemoOptions(input?: DemoDataOptionsInput | null): DemoDataOptions {
    if (!input) return { ...DEFAULT_DEMO_OPTIONS, modules: [...DEFAULT_DEMO_OPTIONS.modules] };

    const rawMonths = typeof input.months === 'string' ? Number(input.months) : input.months;
    const months = Number.isFinite(rawMonths) && rawMonths != null
        ? Math.min(MAX_DEMO_MONTHS, Math.max(MIN_DEMO_MONTHS, Math.round(rawMonths as number)))
        : DEFAULT_DEMO_MONTHS;

    const requested = Array.isArray(input.modules)
        ? input.modules
            .map((m) => String(m).trim().toLowerCase())
            .filter((m): m is DemoModuleGroup => (DEMO_MODULE_GROUPS as readonly string[]).includes(m))
        : null;

    // An empty or unrecognised selection means "everything" — a batch that wrote
    // nothing but core sales would look like a failure to whoever clicked Load.
    const modules = requested && requested.length > 0
        ? Array.from(new Set<DemoModuleGroup>(['core', ...requested]))
        : [...DEMO_MODULE_GROUPS];

    return {
        months,
        modules,
        includeAnomalies: input.includeAnomalies !== false,
    };
}

/** Is this module group part of the batch? `core` is always on. */
export function moduleEnabled(options: DemoDataOptions, group: DemoModuleGroup): boolean {
    return group === 'core' || options.modules.includes(group);
}
