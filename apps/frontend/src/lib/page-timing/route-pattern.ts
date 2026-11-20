/**
 * Page and endpoint names for timing, with the ids taken out, so every sale's
 * page counts as one page (`/sales/:id`) and nothing that identifies a record
 * leaves the browser.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d+$/;
/** cuid / nanoid / Mongo-style ids: long, and a mix of letters and digits. */
const OPAQUE_ID = /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{16,}$/i;

function isIdSegment(segment: string): boolean {
    return UUID.test(segment) || NUMBER.test(segment) || OPAQUE_ID.test(segment);
}

/** `/sales/3f2c…?tab=items` → `/sales/:id`. */
export function routePattern(pathOrUrl: string): string {
    let path = pathOrUrl;
    try {
        // Absolute URLs from the router; relative paths resolve against anything.
        path = new URL(pathOrUrl, 'http://x').pathname;
    } catch {
        path = pathOrUrl.split(/[?#]/)[0];
    }
    const segments = path.split('/').map((segment) => (isIdSegment(segment) ? ':id' : segment));
    const pattern = segments.join('/').replace(/\/+$/, '');
    return (pattern || '/').slice(0, 200);
}

/** `GET`, `/customers/3f2c…?page=2` → `GET /customers/:id`. */
export function endpointPattern(method: string | undefined, endpoint: string): string {
    return `${(method ?? 'GET').toUpperCase()} ${routePattern(endpoint)}`.slice(0, 200);
}
