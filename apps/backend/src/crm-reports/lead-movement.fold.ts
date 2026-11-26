export type MovementLanding = {
    id: string;
    leadId: string;
    toStatusId: string | null;
    toLifecycle: string;
    createdAt: Date;
};

export type MovementStageMeta = {
    id: string;
    code: string;
    name: string;
    lifecycle: string;
    is_system: boolean;
    is_active: boolean;
    sort_order: number;
};

/**
 * One lead's in-window landings → visible stage id, or null if omitted.
 *
 * Latest landing is Lost (and that Lost id is visible) → Lost. Otherwise the
 * furthest visible non-Lost landing by sort_order, then name. Hidden stages
 * and null toStatusId rows are skipped.
 */
export function assignMovementStage(
    landings: MovementLanding[],
    visibleIds: Set<string>,
    metaById: Map<string, MovementStageMeta>,
): string | null {
    if (landings.length === 0) return null;

    const sorted = [...landings].sort((a, b) => {
        const byTime = a.createdAt.getTime() - b.createdAt.getTime();
        if (byTime !== 0) return byTime;
        return a.id.localeCompare(b.id);
    });

    const latest = sorted[sorted.length - 1];
    if (
        latest.toLifecycle === 'LOST' &&
        latest.toStatusId &&
        visibleIds.has(latest.toStatusId)
    ) {
        return latest.toStatusId;
    }

    let best: MovementStageMeta | null = null;
    for (const landing of sorted) {
        if (!landing.toStatusId || !visibleIds.has(landing.toStatusId)) continue;
        if (landing.toLifecycle === 'LOST') continue;
        const meta = metaById.get(landing.toStatusId);
        if (!meta) continue;
        if (
            !best ||
            meta.sort_order > best.sort_order ||
            (meta.sort_order === best.sort_order && meta.name.localeCompare(best.name) < 0)
        ) {
            best = meta;
        }
    }

    return best?.id ?? null;
}
