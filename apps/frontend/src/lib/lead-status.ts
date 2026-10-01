import type { StatusBadgeTone } from '@/components/ui';

/**
 * A lead's pipeline stage as the API returns it on `lead.statusOption`.
 *
 * `lifecycle` is what the stage means to the system (open / won / lost) and is
 * mirrored on `lead.status`; `name` is what the tenant calls it.
 */
export type LeadStage = {
    id: string;
    code: string;
    name: string;
    lifecycle: string;
    is_system: boolean;
};

type StageNaming = Pick<LeadStage, 'code' | 'name' | 'is_system'>;

/** The English names the five seeded stages ship with (lead-taxonomy.seed.ts). */
const SEEDED_STAGE_NAMES: Record<string, string> = {
    NEW: 'New',
    CONTACTED: 'Contacted',
    QUALIFIED: 'Qualified',
    CONVERTED: 'Converted',
    LOST: 'Lost',
};

const OPEN_LIFECYCLES = new Set(['NEW', 'CONTACTED', 'QUALIFIED']);

/**
 * Label for a stage option.
 *
 * A seeded stage still carrying its shipped English name is translated, so
 * tenants who never touch the list keep the localized labels they had before
 * stages were editable. Anything the tenant named itself is shown verbatim, in
 * every locale — the same rule as lead sources.
 */
export function stageOptionLabel(stage: StageNaming, translated: Record<string, string>): string {
    if (stage.is_system && SEEDED_STAGE_NAMES[stage.code] === stage.name) {
        return translated[stage.code] ?? stage.name;
    }
    return stage.name;
}

/**
 * Label for a lead's status. Falls back to the lifecycle for a lead the boot
 * sync has not given a stage yet.
 */
export function leadStatusLabel(
    lead: { status: string; statusOption?: StageNaming | null },
    translated: Record<string, string>,
): string {
    if (lead.statusOption) return stageOptionLabel(lead.statusOption, translated);
    return translated[lead.status] ?? lead.status;
}

/** Badge tone from the lifecycle, so every custom (open) stage reads as in progress. */
export function leadStatusTone(lifecycle: string): StatusBadgeTone {
    if (lifecycle === 'NEW') return 'info';
    if (lifecycle === 'CONVERTED') return 'success';
    if (lifecycle === 'LOST') return 'danger';
    return 'neutral';
}

export function isOpenLifecycle(lifecycle: string | undefined): boolean {
    return Boolean(lifecycle && OPEN_LIFECYCLES.has(lifecycle));
}
