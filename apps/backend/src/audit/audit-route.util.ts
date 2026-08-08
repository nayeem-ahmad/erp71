/**
 * Pure helpers that turn an HTTP request into an audit-log row shape.
 *
 * Kept free of Nest/Express types so the derivation rules can be unit tested
 * directly. `AuditInterceptor` is the only production caller.
 */

/** HTTP verbs that mutate state and are therefore worth recording. */
export const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const METHOD_VERBS: Record<string, string> = {
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
};

const API_PREFIX_RE = /^api$|^v\d+$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Payload keys whose values must never reach the audit table. Matched
 * case-insensitively against the key with separators stripped, so
 * `password_hash`, `passwordHash` and `PASSWORD-HASH` all collapse to the
 * same entry.
 */
const REDACTED_KEYS = new Set([
    'password',
    'passwordhash',
    'currentpassword',
    'newpassword',
    'confirmpassword',
    'passwordconfirmation',
    'secret',
    'clientsecret',
    'token',
    'accesstoken',
    'refreshtoken',
    'apikey',
    'apisecret',
    'authorization',
    'otp',
    'totp',
    'totpsecret',
    'twofactorcode',
    'pin',
    'cvv',
    'cardnumber',
    'accountnumber',
    'privatekey',
]);

export const REDACTED_PLACEHOLDER = '[redacted]';

/** Serialized payloads larger than this are replaced with a size marker. */
const MAX_PAYLOAD_BYTES = 8_192;
const MAX_PAYLOAD_DEPTH = 6;

export interface AuditTarget {
    /** Coarse resource bucket — the first path segment, e.g. `sales`. */
    entity: string;
    /** Dotted action, e.g. `sales.payments.create`. */
    action: string;
    /** Resolved from route params when the path carries an identifier. */
    entityId?: string;
}

export interface ResolveAuditTargetInput {
    method: string;
    /**
     * Either an Express route template (`/api/v1/sales/:id/payments`) or a
     * concrete URL (`/api/v1/sales/8f0.../payments`). Both are handled: the
     * template yields no ids, the concrete URL yields them positionally.
     */
    path: string;
    /** Express route params, preferred source for `entityId`. */
    params?: Record<string, unknown>;
}

/**
 * A hyphenated all-lowercase word — `platform-settings`, `messaging-identity`.
 * Long enough to trip `OPAQUE_ID_RE`, but never what a generated id looks like:
 * uuid, cuid and nanoid all carry digits. Excluding these matters most for the
 * *first* segment, which becomes the entity — `resolveAuditTarget` bails out
 * entirely when that looks like an id, so `POST /admin/platform-settings` would
 * otherwise go unrecorded rather than merely mislabelled.
 */
const RESOURCE_WORD_RE = /^[a-z]+(?:-[a-z]+)*$/;

function isIdentifierSegment(segment: string): boolean {
    if (segment.startsWith(':')) return true;
    if (UUID_RE.test(segment) || NUMERIC_RE.test(segment)) return true;
    return OPAQUE_ID_RE.test(segment) && !RESOURCE_WORD_RE.test(segment);
}

function splitPath(path: string): string[] {
    const withoutQuery = path.split('?')[0].split('#')[0];
    const segments = withoutQuery.split('/').filter(Boolean);
    // Drop the `api/v1` global prefix, however many leading pieces it spans.
    while (segments.length && API_PREFIX_RE.test(segments[0])) {
        segments.shift();
    }
    // `admin` is a routing prefix, not a resource: every controller under it is
    // guarded by `PlatformAdminGuard`, and keeping the segment would file the
    // blog, the tenant list and platform settings all under one `admin` entity,
    // making the entity filter useless for exactly the rows that most need it.
    // What separates a platform row from a tenant one is its null `tenant_id`.
    // Only dropped when something follows, so a bare `/admin` still resolves.
    if (segments.length > 1 && segments[0].toLowerCase() === 'admin') {
        segments.shift();
    }
    return segments;
}

/**
 * Derive `{ entity, action, entityId }` from a request path.
 *
 * The action is `<entity>.<...literal sub-resources>.<verb>` so that
 * `PATCH /sales/:id/payments/:paymentId` becomes `sales.payments.update`.
 * Returns `null` when the path has no resource segment to attribute.
 */
export function resolveAuditTarget(input: ResolveAuditTargetInput): AuditTarget | null {
    const verb = METHOD_VERBS[input.method?.toUpperCase()];
    if (!verb) return null;

    const segments = splitPath(input.path ?? '');
    if (!segments.length) return null;

    const entity = segments[0].toLowerCase();
    if (isIdentifierSegment(entity)) return null;

    const subResources: string[] = [];
    const pathIds: string[] = [];
    for (const segment of segments.slice(1)) {
        if (isIdentifierSegment(segment)) {
            if (!segment.startsWith(':')) pathIds.push(segment);
        } else {
            subResources.push(segment.toLowerCase());
        }
    }

    const params = input.params ?? {};
    const paramId =
        pickParam(params, 'id') ??
        pathIds[pathIds.length - 1] ??
        pickLastParam(params);

    return {
        entity,
        action: [entity, ...subResources, verb].join('.'),
        entityId: paramId,
    };
}

function pickParam(params: Record<string, unknown>, key: string): string | undefined {
    const value = params[key];
    return typeof value === 'string' && value.length ? value : undefined;
}

function pickLastParam(params: Record<string, unknown>): string | undefined {
    const values = Object.values(params).filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
    );
    return values.length ? values[values.length - 1] : undefined;
}

/** Pull an id out of a controller's return value, for `POST` creates. */
export function extractResultId(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const record = result as Record<string, unknown>;
    for (const key of ['id', 'uuid', '_id']) {
        const value = record[key];
        if (typeof value === 'string' && value.length) return value;
    }
    return undefined;
}

function normalizeKey(key: string): string {
    return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Deep-copy a request body with sensitive values replaced. Arrays and nested
 * objects are walked; anything past `MAX_PAYLOAD_DEPTH` is dropped rather than
 * recursed into, so a pathological body cannot stall the request.
 */
export function redactPayload(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value;
    if (depth >= MAX_PAYLOAD_DEPTH) return '[truncated]';

    if (Array.isArray(value)) {
        return value.map((item) => redactPayload(item, depth + 1));
    }

    if (value instanceof Date) return value.toISOString();

    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            out[key] = REDACTED_KEYS.has(normalizeKey(key))
                ? REDACTED_PLACEHOLDER
                : redactPayload(nested, depth + 1);
        }
        return out;
    }

    if (typeof value === 'bigint') return value.toString();
    return value;
}

/**
 * Build the stored payload: redacted body plus the acting store, or
 * `undefined` when there is nothing worth keeping. Oversized bodies collapse
 * to a marker so a bulk import cannot bloat the audit table.
 */
export function buildAuditPayload(
    body: unknown,
    extra?: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const redacted = redactPayload(body);
    const hasBody = !!redacted && typeof redacted === 'object' && Object.keys(redacted).length > 0;

    let payload: Record<string, unknown> = {};
    if (hasBody) {
        payload = Array.isArray(redacted) ? { items: redacted } : (redacted as Record<string, unknown>);
    }
    if (extra) payload = { ...payload, ...extra };

    if (!Object.keys(payload).length) return undefined;

    const serialized = safeStringify(payload);
    if (serialized === undefined) return extra ? { ...extra } : undefined;
    if (serialized.length > MAX_PAYLOAD_BYTES) {
        return { _truncated: true, _bytes: serialized.length, ...(extra ?? {}) };
    }
    return payload;
}

function safeStringify(value: unknown): string | undefined {
    try {
        return JSON.stringify(value);
    } catch {
        return undefined;
    }
}

export interface AuditRequestMeta {
    ipAddress?: string;
    userAgent?: string;
}

function firstHeader(value: unknown): string | undefined {
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
    return typeof value === 'string' && value.length ? value : undefined;
}

/**
 * Pull the caller's IP and user agent off an Express request.
 *
 * Behind Caddy the real client address only survives in `x-forwarded-for`, so
 * that header wins over the socket address; the left-most entry is the
 * original client.
 */
export function extractRequestMeta(request: any): AuditRequestMeta {
    const forwarded = firstHeader(request?.headers?.['x-forwarded-for']);
    const socketIp = request?.ip ?? request?.socket?.remoteAddress;
    const ipAddress = forwarded
        ? forwarded.split(',')[0].trim()
        : typeof socketIp === 'string' && socketIp.length
          ? socketIp
          : undefined;

    return {
        ipAddress,
        userAgent: firstHeader(request?.headers?.['user-agent']),
    };
}
