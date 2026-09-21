export const KNOCK_CATEGORIES = ['support', 'bug', 'feature', 'general'] as const;
export type KnockCategory = (typeof KNOCK_CATEGORIES)[number];
export const FEEDBACK_CATEGORIES: readonly KnockCategory[] = ['bug', 'feature', 'general'];

export function isKnockCategory(value: string): value is KnockCategory {
    return (KNOCK_CATEGORIES as readonly string[]).includes(value);
}

export function isFeedbackCategory(value: string): value is Exclude<KnockCategory, 'support'> {
    return (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export function inboxEnabled(features: { support: boolean; feedback: boolean }): boolean {
    return features.support || features.feedback;
}

export function isCategoryEnabled(
    features: { support: boolean; feedback: boolean },
    category: KnockCategory,
): boolean {
    return category === 'support' ? features.support : features.feedback;
}

export function deriveKnockSubject(
    category: KnockCategory,
    body: string,
    page?: string | null,
): string {
    const snippet = body.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (category === 'support') return snippet || 'Support request';
    const label = category === 'bug' ? 'Bug' : category === 'feature' ? 'Feature' : 'Feedback';
    if (page?.trim()) {
        return `${label} on ${page.trim()}`.slice(0, 200);
    }
    return snippet || label;
}

export function threadCategoryWhere(category?: string, kind?: string): Record<string, unknown> {
    if (kind === 'feedback' || category === 'feedback') {
        return { category: { in: [...FEEDBACK_CATEGORIES] } };
    }
    if (category && isKnockCategory(category)) {
        return { category };
    }
    return {};
}

/**
 * The ticket number an admin typed into the inbox search box, or `null` when
 * what they typed is not one.
 *
 * Accepts `1042`, `#1042` and surrounding spaces, because a shop owner reading
 * their ticket number down the phone is as likely to include the hash as not.
 * Rejects anything else — including a number too large to be a real ticket —
 * so the caller can fall back to a plain subject search rather than send
 * Postgres an out-of-range `int4` comparison and get a 500.
 */
export function parseTicketNumberQuery(search: string): number | null {
    const match = /^#?\s*(\d{1,9})$/.exec(search.trim());
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}
