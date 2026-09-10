/**
 * Naming a workspace in a URL, so a link can say which shop to open.
 *
 * Someone who belongs to more than one workspace lands on `/select-account`
 * after signing in. That is right when they arrived with no particular shop in
 * mind, and pure friction when they did — a bookmark, a link in a WhatsApp
 * group, a shortcut on the shop's counter tablet. `/w/<slug>` is that intent
 * written down: it carries the workspace through the login flow and enters it
 * directly, skipping the chooser.
 *
 * **Nothing here is an access decision.** A slug is only ever resolved against
 * the workspaces `/auth/me` already returned for the signed-in user, so the
 * worst a wrong or hostile slug can do is fail to match and fall back to the
 * chooser. `TenantInterceptor` re-checks membership on every request regardless.
 *
 * No `slug` column exists on `Tenant`, and this deliberately does not add one:
 * a workspace answers to the identifiers it already has, so every existing shop
 * has a working URL from the day this ships. In precedence order:
 *
 *  1. **Its id** — exact, unambiguous, and what an automated link should use.
 *  2. **Its `storefront_slug`** — already unique platform-wide and already
 *     chosen by the owner as "what this shop is called in a URL".
 *  3. **Its slugified name** — what a human would guess and type.
 *
 * Precedence is per tier rather than per tenant: two shops named "Karim Store"
 * are genuinely ambiguous at tier 3, but if one of them is `storefront_slug`
 * `karim-store` then tier 2 settled it before tier 3 was reached.
 */

import { safeAppPath } from './safe-redirect';

/** The tenant shape this needs — a subset of what `/auth/me` returns. */
export type WorkspaceTenant = {
    id: string;
    name?: string | null;
    storefront_slug?: string | null;
};

export type WorkspaceMatch<T extends WorkspaceTenant = WorkspaceTenant> =
    /** Exactly one workspace answers to the slug. */
    | { status: 'matched'; tenant: T }
    /** The user belongs to no workspace by that name. */
    | { status: 'not-found' }
    /** Several answer to it, so only the user can say which they meant. */
    | { status: 'ambiguous'; tenants: T[] };

/** Longest slug we will build from a name. Matches the blog's own limit. */
const MAX_SLUG_LENGTH = 80;

/**
 * Turn a workspace name into a URL segment: lowercase, ASCII, hyphenated.
 *
 * Mirrors `blog-slug.ts` on the backend, including dropping non-ASCII rather
 * than transliterating it — a Bangla shop name slugifies to `''`, which matches
 * nothing, and that shop is reached by its `storefront_slug` or its id instead.
 * A percent-encoded Bangla URL would be unreadable everywhere it got pasted,
 * and a bad transliteration produces worse slugs than no slug at all.
 */
export function slugifyWorkspaceName(name: string | null | undefined): string {
    const slug = (name ?? '')
        .normalize('NFKD')
        // Strip the combining marks the decomposition left behind, so "café"
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
 * Fold whatever came out of the URL into the form the tiers compare against.
 *
 * Trailing slashes, `%20`-decoded spaces and a capitalised shop name typed by
 * hand all collapse to the same thing, so `/w/Karim%20Store` and
 * `/w/karim-store` open the same shop.
 */
export function normalizeWorkspaceSlug(raw: string | null | undefined): string {
    return slugifyWorkspaceName(raw);
}

/** The canonical `/w/...` link for a workspace, optionally deep into the app. */
export function workspaceEntryPath(tenant: WorkspaceTenant, target = ''): string {
    const slug = preferredWorkspaceSlug(tenant);
    const suffix = target && target !== '/' ? (target.startsWith('/') ? target : `/${target}`) : '';
    return `/w/${slug}${suffix}`;
}

/**
 * The slug to *show* for a workspace: the friendliest identifier it has, which
 * is the reverse of the resolution order — a name a person recognises first,
 * and the id only when there is nothing else to go on.
 */
export function preferredWorkspaceSlug(tenant: WorkspaceTenant): string {
    // Reverse of the resolution order on purpose. `storefront_slug` is unique
    // platform-wide, so a link built from it can never come back ambiguous; a
    // slugified name is friendlier but two shops may share one; the id always
    // works and reads like nothing at all.
    return slugifyWorkspaceName(tenant?.storefront_slug)
        || slugifyWorkspaceName(tenant?.name)
        || String(tenant?.id ?? '');
}

/**
 * Which workspace `slug` names, among the ones this user actually belongs to.
 *
 * Tiers are tried in order and the first that matches *anything* decides the
 * outcome, including deciding that the answer is ambiguous — falling through to
 * a weaker tier after a strong one matched two shops would let a slugified name
 * silently outrank an exact `storefront_slug`.
 */
export function resolveWorkspaceSlug<T extends WorkspaceTenant>(
    tenants: readonly T[] | null | undefined,
    slug: string | null | undefined,
): WorkspaceMatch<T> {
    const list = Array.isArray(tenants) ? tenants.filter(Boolean) : [];
    const wanted = normalizeWorkspaceSlug(slug);
    if (!wanted || list.length === 0) return { status: 'not-found' };

    const tiers: ((tenant: T) => string)[] = [
        (tenant) => String(tenant.id ?? '').toLowerCase(),
        (tenant) => normalizeWorkspaceSlug(tenant.storefront_slug),
        (tenant) => slugifyWorkspaceName(tenant.name),
    ];

    for (const identify of tiers) {
        const hits = list.filter((tenant) => {
            const candidate = identify(tenant);
            return candidate !== '' && candidate === wanted;
        });
        if (hits.length === 1) return { status: 'matched', tenant: hits[0] };
        if (hits.length > 1) return { status: 'ambiguous', tenants: hits };
    }

    return { status: 'not-found' };
}

/** What `/w/<slug>/<rest…>` asked for. */
export type WorkspaceEntry = {
    /** The workspace segment, already normalised. Empty when there is none. */
    slug: string;
    /** Where to land inside that workspace. Always app-relative. */
    redirect: string;
};

/**
 * Split a `/w/...` pathname into the workspace it names and the page it wants.
 *
 * `/w/karim-store` → the workspace's default landing page; `/w/karim-store/sales/pos`
 * → the POS inside it. Kept pure and separate from the page component so the
 * parsing rules can be tested without a router.
 */
export function parseWorkspaceEntryPath(pathname: string | null | undefined, home = '/dashboard'): WorkspaceEntry {
    const raw = (pathname ?? '').split('?')[0].split('#')[0];
    // The tail stays encoded. It is rebuilt into a path we navigate to, and a
    // segment carrying an encoded `/` would decode into a real one — which is
    // how `/w/acme/%2F%2Fevil.com` turns into a protocol-relative URL. Only the
    // slug is decoded, and it is never navigated to, only compared.
    const segments = raw.split('/').filter(Boolean);

    // Drop the leading `/w`; anything else is not an entry URL at all.
    if (segments[0]?.toLowerCase() !== 'w') return { slug: '', redirect: home };

    const [, slugSegment, ...rest] = segments;
    const redirect = rest.length > 0 ? safeAppPath(`/${rest.join('/')}`, home) : home;
    return { slug: normalizeWorkspaceSlug(decodeSegment(slugSegment)), redirect };
}

/**
 * `usePathname()` hands back the encoded pathname, so `/w/Karim%20Store` needs
 * decoding before it can be slugified. A malformed escape is left as-is rather
 * than thrown — it simply will not match any workspace.
 */
function decodeSegment(segment: string | undefined): string {
    if (!segment) return '';
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}
