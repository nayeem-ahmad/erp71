/**
 * Where a `?redirect=` (or a `/w/<slug>/<path>` tail) is allowed to send someone.
 *
 * Every auth screen takes a destination from the URL, and a destination read
 * out of a URL is attacker-controlled: a link that signs a shop owner in and
 * then drops them on someone else's page is a phishing primitive, not a
 * convenience. So a path is honoured only when it can name nothing but a page
 * of this app.
 *
 * `startsWith('/')` alone is not that test. `//evil.com` and `/\evil.com` both
 * start with a slash and both leave the origin — the first is a protocol-relative
 * URL, and the second is one after the browser's own backslash normalisation.
 */

/** Fallback used when a caller does not name one: the app's own front door. */
const DEFAULT_PATH = '/dashboard';

/** Space, C0 controls and DEL — everything a URL parser drops before parsing. */
function isStrippedByUrlParser(char: string): boolean {
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
}

/**
 * The path if it is safe to navigate to, else `fallback`.
 *
 * Safe means same-origin by construction: one leading slash, no scheme, no
 * host. Whitespace and control characters are stripped rather than rejected,
 * because the URL parser strips them too — a newline spliced into the middle of
 * `/` + `/evil.com` has to be judged the way the browser will read it, not the
 * way it arrived.
 */
export function safeAppPath(value: string | null | undefined, fallback = DEFAULT_PATH): string {
    if (typeof value !== 'string') return fallback;

    const path = Array.from(value).filter((char) => !isStrippedByUrlParser(char)).join('');

    if (!path.startsWith('/')) return fallback;
    // `//host` and `/\host` both address another origin.
    if (path.startsWith('//') || path.startsWith('/\\')) return fallback;

    return path;
}
