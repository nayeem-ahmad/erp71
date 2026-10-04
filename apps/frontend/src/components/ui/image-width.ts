/*
 * Image widths, carried on the URL. Plain string functions with no imports, so
 * a page that only draws markdown can use them without loading the editor's
 * ProseMirror half — see the note in `markdown-bridge.ts`.
 */

/**
 * The width an author dragged an image to, carried on the URL as `?w=`.
 *
 * On the URL rather than in a custom `![alt|420](url)` syntax, so what is
 * stored stays standard markdown: it renders correctly wherever the
 * description is pointed, and an asset host that takes a width parameter can
 * serve the smaller file rather than shipping a full screenshot to be scaled
 * down in the browser.
 */

/** A base for parsing relative URLs; never sent anywhere. */
const RELATIVE_BASE = 'https://relative.invalid';

const isRelative = (url: string) => !/^[a-z][a-z0-9+.-]*:/i.test(url);

function parse(url: string): URL | null {
    try {
        return new URL(url, isRelative(url) ? RELATIVE_BASE : undefined);
    } catch {
        return null;
    }
}

/** Back to how it was written: relative in, relative out. */
function format(parsed: URL, original: string): string {
    return isRelative(original)
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.toString();
}

export function widthFromUrl(url: string): number | null {
    const parsed = parse(url);
    const raw = parsed?.searchParams.get('w');
    if (!raw) return null;
    const width = Number(raw);
    return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
}

export function urlWithWidth(url: string, width: number | null): string {
    // A `data:` or `blob:` URL has no query string to speak of: everything
    // after the comma is payload, and a `?w=` glued to the end of base64 is an
    // image the browser cannot decode. Neither is ever stored — the editor
    // swaps a blob for the uploaded URL before serializing — so there is
    // nothing to record a width against.
    if (/^(data|blob):/i.test(url)) return url;

    const parsed = parse(url);
    if (!parsed) return url;
    if (width === null) parsed.searchParams.delete('w');
    else parsed.searchParams.set('w', String(Math.round(width)));
    return format(parsed, url);
}


/**
 * The same image, delivered no wider than `width`.
 *
 * `?w=` on its own is only a note to this app about how big to draw the
 * picture — Cloudinary takes its transforms as a path segment, so a query
 * parameter changes nothing about what crosses the wire. This turns that
 * note into a real request, which is what keeps a 4 MB screenshot from being
 * downloaded in full to fill a 160px tile.
 *
 * `c_limit` so an image already narrower than the cap is left alone rather
 * than stretched; `q_auto,f_auto` to match what the upload itself asks for.
 *
 * Only Cloudinary, because only Cloudinary's vocabulary is known here. Any
 * other host gets its URL back untouched: a guessed transform would turn a
 * working image into a 404.
 */
const CLOUDINARY_DELIVERY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video|raw)\/upload\/)(.*)$/;
/** A path segment that is already a transform, e.g. `w_320,c_limit`. */
const TRANSFORM_SEGMENT = /^[a-z]{1,3}_[^/]*\//;

export function sizedImageUrl(url: string, width: number | null): string {
    if (width === null) return url;
    const match = CLOUDINARY_DELIVERY.exec(url);
    if (!match) return url;

    const [, delivery, rest] = match;
    // Already asked for: re-wrapping would stack transforms on every render.
    if (TRANSFORM_SEGMENT.test(rest)) return url;
    return `${delivery}w_${Math.round(width)},c_limit,q_auto,f_auto/${rest}`;
}
