/**
 * Post lifecycle, shared by the platform blog and the tenant storefront blog.
 *
 * Kept as string literals rather than a Prisma enum for the reason
 * `LeadConversation.type` gives: adding a state should not need a schema
 * change, and every read filters on an explicit allowlist anyway.
 */
export const BlogStatus = {
    DRAFT: 'DRAFT',
    SCHEDULED: 'SCHEDULED',
    PUBLISHED: 'PUBLISHED',
    ARCHIVED: 'ARCHIVED',
} as const;
export type BlogStatus = (typeof BlogStatus)[keyof typeof BlogStatus];

export const BLOG_STATUSES = Object.values(BlogStatus);

/** Which surfaces a platform post may be served on. */
export const BlogAudience = {
    /** erp71.com/blog only — marketing and SEO. */
    PUBLIC: 'PUBLIC',
    /** In-app "What's new" only — release notes nobody outside needs. */
    IN_APP: 'IN_APP',
    BOTH: 'BOTH',
} as const;
export type BlogAudience = (typeof BlogAudience)[keyof typeof BlogAudience];

export const BLOG_AUDIENCES = Object.values(BlogAudience);

export function isPublicAudience(audience: string): boolean {
    return audience === BlogAudience.PUBLIC || audience === BlogAudience.BOTH;
}

export function isInAppAudience(audience: string): boolean {
    return audience === BlogAudience.IN_APP || audience === BlogAudience.BOTH;
}

/**
 * The transitions the API allows.
 *
 * ARCHIVED is reachable from anywhere and leads back only to DRAFT: pulling a
 * post and then re-publishing it should go through a deliberate edit rather
 * than flipping straight back to live.
 */
const ALLOWED: Record<string, BlogStatus[]> = {
    [BlogStatus.DRAFT]: [BlogStatus.SCHEDULED, BlogStatus.PUBLISHED, BlogStatus.ARCHIVED],
    [BlogStatus.SCHEDULED]: [BlogStatus.DRAFT, BlogStatus.PUBLISHED, BlogStatus.ARCHIVED],
    [BlogStatus.PUBLISHED]: [BlogStatus.DRAFT, BlogStatus.ARCHIVED],
    [BlogStatus.ARCHIVED]: [BlogStatus.DRAFT],
};

export function canTransition(from: string, to: string): boolean {
    if (from === to) return true;
    return (ALLOWED[from] ?? []).includes(to as BlogStatus);
}
