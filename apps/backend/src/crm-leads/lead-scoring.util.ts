import { LeadPriority, LeadSource, LeadStatus } from './crm-leads.dto';

const SOURCE_WEIGHT: Record<LeadSource, number> = {
    REFERRAL: 25,
    WEBSITE: 20,
    FACEBOOK: 15,
    WALK_IN: 15,
    PHONE: 10,
    OTHER: 5,
};

const PRIORITY_WEIGHT: Record<LeadPriority, number> = {
    URGENT: 20,
    HIGH: 15,
    MEDIUM: 10,
    LOW: 5,
};

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
    source: LeadSource;
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

    let score = SOURCE_WEIGHT[lead.source] + PRIORITY_WEIGHT[lead.priority];
    score += recencyWeight(lead.last_contacted_at);
    score += Math.min(conversationCount * 5, MAX_INTERACTION_POINTS);

    const isOverdue = lead.next_step_date != null && lead.next_step_date.getTime() < Date.now();
    if (isOverdue) score -= OVERDUE_PENALTY;

    return Math.max(0, Math.min(100, score));
}
