import { LeadPriority, LeadStatus } from '@prisma/client';

const PRIORITY_WEIGHT: Record<LeadPriority, number> = {
    URGENT: 20,
    HIGH: 15,
    MEDIUM: 10,
    LOW: 5,
};

/**
 * Used when a lead's source row is missing or carries a non-finite weight.
 * Matches the weight the old hardcoded SOURCE_WEIGHT map gave OTHER.
 */
export const DEFAULT_SOURCE_WEIGHT = 5;

const MAX_INTERACTION_POINTS = 25;
const OVERDUE_PENALTY = 15;

function recencyWeight(lastContactedAt: Date | null): number {
    if (!lastContactedAt) return 0;
    const daysSinceContact = (Date.now() - lastContactedAt.getTime()) / 86_400_000;
    if (daysSinceContact <= 3) return 25;
    if (daysSinceContact <= 7) return 15;
    if (daysSinceContact <= 30) return 5;
    return 0;
}

export interface LeadScoringInput {
    status: LeadStatus;
    /**
     * The lead's source weight, read from `LeadSourceOption.score_weight`.
     *
     * Deliberately a number rather than the source itself: sources are now
     * tenant-defined, so there is no closed set to key a lookup map on. Naming it
     * `sourceWeight` (not `source`) also makes every call site a compile error
     * until it is updated, which is how this change reaches all four of them.
     */
    sourceWeight: number;
    priority: LeadPriority;
    last_contacted_at: Date | null;
    next_step_date: Date | null;
}

/**
 * 0-100 lead score. CONVERTED/LOST leads are pinned so the score reflects
 * their final outcome rather than stale engagement signals.
 */
export function computeLeadScore(lead: LeadScoringInput, conversationCount: number): number {
    if (lead.status === LeadStatus.CONVERTED) return 100;
    if (lead.status === LeadStatus.LOST) return 0;

    // Guarded rather than trusted: `score` is an Int column, and a NaN here used
    // to propagate through Math.max/Math.min unchanged and get rejected by
    // Prisma at write time — a 500 that also rolled back the enclosing
    // conversation transaction.
    const sourceWeight = Number.isFinite(lead.sourceWeight)
        ? lead.sourceWeight
        : DEFAULT_SOURCE_WEIGHT;

    let score = sourceWeight + PRIORITY_WEIGHT[lead.priority];
    score += recencyWeight(lead.last_contacted_at);
    score += Math.min(conversationCount * 5, MAX_INTERACTION_POINTS);

    const isOverdue = lead.next_step_date != null && lead.next_step_date.getTime() < Date.now();
    if (isOverdue) score -= OVERDUE_PENALTY;

    return Math.max(0, Math.min(100, score));
}
