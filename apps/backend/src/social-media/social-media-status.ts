/**
 * Lifecycle of a platform social post.
 *
 * String literals rather than a Prisma enum, for the same reason `BlogStatus`
 * gives: a new state should not need a schema change, and every read filters on
 * an explicit allowlist anyway.
 *
 * PUBLISHED here means "handed to Buffer", not "live on Facebook". Buffer owns
 * the queue after that and there is no webhook back, so the platform cannot
 * honestly claim more than the handover.
 */
export const SocialPostStatus = {
    DRAFT: 'DRAFT',
    /** Queued in Buffer for a future slot, or waiting on `scheduled_for`. */
    SCHEDULED: 'SCHEDULED',
    PUBLISHED: 'PUBLISHED',
    /** Every push attempt for this post failed. Editable and re-pushable. */
    FAILED: 'FAILED',
} as const;
export type SocialPostStatus = (typeof SocialPostStatus)[keyof typeof SocialPostStatus];

export const SOCIAL_POST_STATUSES = Object.values(SocialPostStatus);

/** Networks the composer offers. Advisory only — see the schema comment. */
export const SOCIAL_NETWORKS = [
    'facebook',
    'instagram',
    'linkedin',
    'x',
    'threads',
    'pinterest',
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Outcome of one handover to one channel. */
export const SocialPushStatus = {
    SENT: 'SENT',
    FAILED: 'FAILED',
} as const;
export type SocialPushStatus = (typeof SocialPushStatus)[keyof typeof SocialPushStatus];

/**
 * Transitions the API allows on a manual status change.
 *
 * PUBLISHED is deliberately a dead end for manual edits: the copy is already in
 * Buffer's queue and moving the row back to DRAFT would suggest it can be
 * unsent, which it cannot. FAILED goes back to DRAFT so a rejected post can be
 * fixed and pushed again.
 */
const ALLOWED: Record<string, SocialPostStatus[]> = {
    [SocialPostStatus.DRAFT]: [SocialPostStatus.SCHEDULED, SocialPostStatus.PUBLISHED],
    [SocialPostStatus.SCHEDULED]: [SocialPostStatus.DRAFT, SocialPostStatus.PUBLISHED],
    [SocialPostStatus.PUBLISHED]: [],
    [SocialPostStatus.FAILED]: [SocialPostStatus.DRAFT, SocialPostStatus.SCHEDULED],
};

export function canTransition(from: string, to: string): boolean {
    if (from === to) return true;
    return (ALLOWED[from] ?? []).includes(to as SocialPostStatus);
}

/**
 * The status a post lands on after a push round.
 *
 * A partial success counts as published: something did go out, and calling the
 * whole post FAILED would hide that from anyone reading the list. The per-channel
 * failures stay visible in the push history either way.
 */
export function statusAfterPush(
    results: { status: string; due_at?: Date | null }[],
    now: Date = new Date(),
): SocialPostStatus {
    const sent = results.filter((row) => row.status === SocialPushStatus.SENT);
    if (sent.length === 0) return SocialPostStatus.FAILED;
    // Everything that went out is dated in the future — Buffer will publish it
    // later, so the post is scheduled rather than published. A queued post with
    // no explicit date is treated as published: Buffer picks the slot and the
    // platform has no way to know when it lands.
    if (sent.every((row) => row.due_at && row.due_at.getTime() > now.getTime())) {
        return SocialPostStatus.SCHEDULED;
    }
    return SocialPostStatus.PUBLISHED;
}
