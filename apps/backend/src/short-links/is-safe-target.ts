/**
 * Validates a short-link target.
 *
 * The shortener accepts external URLs, which means a link on our own domain can
 * point anywhere. This function is the control that keeps `app.erp71.com/s/...`
 * from becoming a clean phishing vector, so it fails closed: anything it cannot
 * confidently classify is rejected.
 *
 * It is deliberately free of NestJS and Prisma imports so it can be read and
 * tested as a unit.
 */

export type SafeTargetResult =
    | { ok: true; kind: 'internal' | 'external'; url: string }
    | { ok: false; reason: string };

const MAX_LENGTH = 2048;

/**
 * Shortening an auth path lets a link on our own domain walk someone into a
 * credential form from an untrusted context, which is the exact shape of a
 * phishing flow that a wary user would otherwise catch by reading the domain.
 */
const BLOCKED_INTERNAL_PREFIXES = [
    '/login',
    '/signup',
    '/reset-password',
    '/verify-email',
    '/accept-invitation',
];

function isBlockedInternalPath(pathname: string): boolean {
    const lower = pathname.toLowerCase();
    return BLOCKED_INTERNAL_PREFIXES.some(
        // Prefix match on a segment boundary, so `/loginary` stays allowed.
        (prefix) => lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}?`),
    );
}

function isPrivateIpv4(host: string): boolean {
    const parts = host.split('.');
    if (parts.length !== 4) return false;
    const octets = parts.map((part) => Number(part));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

    const [a, b] = octets;
    if (a === 127) return true;                      // loopback
    if (a === 10) return true;                       // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;          // RFC1918
    if (a === 169 && b === 254) return true;          // link-local, incl. cloud metadata
    if (a === 0) return true;
    return false;
}

function isPrivateHost(rawHost: string): boolean {
    const host = rawHost.toLowerCase();

    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;

    // URL keeps IPv6 literals in brackets.
    if (host.startsWith('[') && host.endsWith(']')) {
        const inner = host.slice(1, -1);
        if (inner === '::1' || inner === '::') return true;
        // fc00::/7 — unique local addresses.
        if (inner.startsWith('fc') || inner.startsWith('fd')) return true;
        return false;
    }

    return isPrivateIpv4(host);
}

export function isSafeTarget(raw: string): SafeTargetResult {
    const value = (raw ?? '').trim();

    if (!value) return { ok: false, reason: 'Target URL is required.' };
    if (value.length > MAX_LENGTH) {
        return { ok: false, reason: `Target URL must be under ${MAX_LENGTH} characters.` };
    }

    if (value.startsWith('/')) {
        // `//host` is protocol-relative and `/\host` is the same thing to a
        // browser — both look like paths here and navigate off-site.
        if (value.startsWith('//') || value.startsWith('/\\')) {
            return { ok: false, reason: 'Protocol-relative URLs are not allowed.' };
        }

        let pathname = value;
        try {
            pathname = new URL(value, 'https://app.erp71.com').pathname;
        } catch {
            return { ok: false, reason: 'Target path is malformed.' };
        }

        if (isBlockedInternalPath(pathname)) {
            return { ok: false, reason: 'Authentication pages cannot be shortened.' };
        }

        return { ok: true, kind: 'internal', url: value };
    }

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return { ok: false, reason: 'Enter a full URL starting with https:// or an internal path starting with /.' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'Only http and https links are allowed.' };
    }

    if (parsed.username || parsed.password) {
        return { ok: false, reason: 'URLs containing a username or password are not allowed.' };
    }

    if (isPrivateHost(parsed.hostname)) {
        return { ok: false, reason: 'Private and local network addresses are not allowed.' };
    }

    return { ok: true, kind: 'external', url: parsed.toString() };
}
