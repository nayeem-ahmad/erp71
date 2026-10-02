/** One pipeline stage with the number of leads on it, in the tenant's order. */
export type StageCount = {
    id: string;
    code: string;
    name: string;
    lifecycle: string;
    is_system: boolean;
    count: number;
};

type StageOption = Omit<StageCount, 'count'> & { is_active: boolean; sort_order: number };

/** The select both callers load stage options with. */
export const STAGE_OPTION_SELECT = {
    id: true,
    code: true,
    name: true,
    lifecycle: true,
    is_system: true,
    is_active: true,
    sort_order: true,
} as const;

/**
 * Per-stage lead counts for the CRM hub and dashboard funnel.
 *
 * Every active stage appears, zero-filled, so the funnel's shape does not jump
 * around as stages empty. A hidden stage appears only while leads still sit on
 * it, so those leads are not silently missing from the total. Leads without a
 * stage yet (before the boot sync has backfilled them) are left out; the
 * lifecycle-keyed `counts` beside this still include them.
 */
export function stageCounts(
    options: StageOption[],
    grouped: { status_id: string | null; _count: { _all: number } }[],
): StageCount[] {
    const byId = new Map<string, number>();
    for (const row of grouped) {
        if (row.status_id) byId.set(row.status_id, row._count._all);
    }
    return [...options]
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .filter((o) => o.is_active || (byId.get(o.id) ?? 0) > 0)
        .map((o) => ({
            id: o.id,
            code: o.code,
            name: o.name,
            lifecycle: o.lifecycle,
            is_system: o.is_system,
            count: byId.get(o.id) ?? 0,
        }));
}
