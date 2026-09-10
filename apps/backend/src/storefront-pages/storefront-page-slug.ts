import { slugify } from '../blog/blog-slug';
import { RESERVED_PAGE_SLUGS } from './storefront-page-constants';

/**
 * Slug derivation for storefront pages, kept pure so the rules can be tested
 * without a database — same posture as `blog-slug.ts`, whose `slugify` it
 * reuses rather than re-deriving.
 *
 * The reserved set differs from the blog's, which is why this is its own
 * function: `/store/<slug>/shop` and `/store/<slug>/blog` are real routes, and
 * a page called "Shop" sitting beside the shop link in the same menu is a trap
 * for the owner long before it is one for a shopper.
 */
export function resolvePageSlug(desired: string, taken: Iterable<string>, fallback = 'page'): string {
    const base = slugify(desired) || fallback;
    const reserved = RESERVED_PAGE_SLUGS.has(base) ? `${base}-page` : base;

    const used = new Set(taken);
    if (!used.has(reserved)) return reserved;

    // Numbered rather than random: a shop owner can read "about-2", correct it,
    // and tell it apart from "about" in their own menu.
    for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `${reserved}-${suffix}`;
        if (!used.has(candidate)) return candidate;
    }

    throw new Error(`Could not resolve a unique slug for "${desired}"`);
}
