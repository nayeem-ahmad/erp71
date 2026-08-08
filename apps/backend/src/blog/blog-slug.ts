/**
 * Slug derivation for blog posts, kept pure so the rules can be tested without
 * a database — the same reason `short-link-code.ts` sits beside its service.
 *
 * A slug is a permanent public URL. Two things follow: it must be stable once
 * published (renames go through the slug-history table, never a silent
 * overwrite), and it must be derived from the *English* title even for a post
 * whose body is Bangla, because a percent-encoded Bangla URL is unreadable
 * wherever it gets pasted.
 */

const MAX_SLUG_LENGTH = 80;

/**
 * Route segments that would collide with a real page under `/blog/...`.
 * A post slugged `category` would shadow `/blog/category/<slug>`.
 */
export const RESERVED_SLUGS = new Set(['category', 'categories', 'tag', 'tags', 'page', 'rss', 'feed', 'author']);

/**
 * Turn a title into a URL segment: lowercase, ASCII, hyphen-separated.
 *
 * Non-ASCII is dropped rather than transliterated. Transliterating Bangla well
 * is a real problem and doing it badly produces worse slugs than falling back
 * to an explicit one, so a title with no ASCII at all returns `''` and the
 * caller supplies a fallback.
 */
export function slugify(title: string): string {
    const slug = (title ?? '')
        .normalize('NFKD')
        // Strip combining marks left behind by the decomposition, so "café"
        // becomes "cafe" rather than "caf".
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (slug.length <= MAX_SLUG_LENGTH) return slug;

    // Cut on a hyphen so the slug never ends mid-word.
    const truncated = slug.slice(0, MAX_SLUG_LENGTH);
    const lastHyphen = truncated.lastIndexOf('-');
    return lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
}

/**
 * Resolve a desired slug against slugs already in use.
 *
 * Collisions get `-2`, `-3`, … rather than a random suffix: a numbered slug is
 * something an editor can read and correct, and the count is a useful signal
 * that a title is being reused.
 *
 * `taken` must include historic slugs as well as live ones — reusing a slug a
 * different post once had would send its permanent redirect to the wrong
 * article.
 */
export function resolveSlug(desired: string, taken: Iterable<string>, fallback = 'post'): string {
    const base = slugify(desired) || fallback;
    const reserved = RESERVED_SLUGS.has(base) ? `${base}-post` : base;

    const used = new Set(taken);
    if (!used.has(reserved)) return reserved;

    for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `${reserved}-${suffix}`;
        if (!used.has(candidate)) return candidate;
    }

    throw new Error(`Could not resolve a unique slug for "${desired}"`);
}
