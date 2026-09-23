/**
 * A board's readable key.
 *
 * Board names are deliberately not unique — a soft-deleted board would
 * otherwise hold its name hostage against a new one, as the comment on the
 * model says — so a slug is derived from the name and then disambiguated rather
 * than assumed unique.
 */

const MAX_LENGTH = 60;

/** Lowercase, non-alphanumerics to hyphens, collapsed, trimmed, capped. */
export function slugify(name: string): string {
    return (name ?? '')
        .normalize('NFC')
        .toLowerCase()
        // `\p{L}`/`\p{N}` keep every script rather than ASCII alone: a board
        // named in Bengali must not slugify to nothing. `\p{M}` keeps the
        // combining marks Bengali vowel signs are made of — without it "বোর্ড"
        // loses its vowels and two different names collapse together.
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, MAX_LENGTH)
        .replace(/-$/, '');
}

/** `otb`, then `otb-2`, `otb-3`, … against the slugs already taken. */
export function uniqueSlug(base: string, taken: Set<string>): string {
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

/** For a name that yields no slug at all — punctuation only, say. */
export function slugFallback(id: string): string {
    return `board-${id.slice(0, 8)}`;
}
