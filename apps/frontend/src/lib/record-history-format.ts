/**
 * Display helpers for record-history snapshots: they arrive as plain JSON —
 * numbers, ISO strings, nested lines — and the admin page shows them as
 * readable field names and values.
 */

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** `items[Rice 5kg].price_at_sale` → `items › Rice 5kg › price at sale`. */
export function humanizeHistoryPath(path: string): string {
    // A line label is a product name and may hold dots or underscores of its
    // own, so it is kept verbatim; only field names are split and spaced.
    const segments: string[] = [];
    for (const match of path.matchAll(/\[([^\]]+)\]|([^.[\]]+)/g)) {
        segments.push(match[1] ?? match[2].replace(/_/g, ' '));
    }
    return segments.join(' › ');
}

/** Keys starting with `_` are the diff's bookkeeping, never data. */
export function visibleEntries(value: Record<string, unknown>): [string, unknown][] {
    return Object.entries(value).filter(([key]) => !key.startsWith('_'));
}

export function isEmptyHistoryValue(value: unknown): boolean {
    return value === null || value === undefined || value === '';
}

/**
 * A scalar as text. Objects and arrays are left to the caller, which lays
 * them out as nested rows; this is the fallback when they must be one line.
 */
export function formatHistoryValue(
    value: unknown,
    formatDateTime: (iso: string) => string,
): string {
    if (isEmptyHistoryValue(value)) return '';
    if (typeof value === 'boolean') return value ? '✓' : '✗';
    if (typeof value === 'string') return ISO_DATETIME.test(value) ? formatDateTime(value) : value;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
        return value
            .map((item) =>
                item && typeof item === 'object'
                    ? String((item as Record<string, unknown>)._label ?? JSON.stringify(stripBookkeeping(item)))
                    : formatHistoryValue(item, formatDateTime),
            )
            .join(', ');
    }
    if (typeof value === 'object') {
        return visibleEntries(value as Record<string, unknown>)
            .filter(([, nested]) => !isEmptyHistoryValue(nested))
            .map(([key, nested]) => `${key.replace(/_/g, ' ')}: ${formatHistoryValue(nested, formatDateTime)}`)
            .join(' · ');
    }
    return String(value);
}

function stripBookkeeping(item: object): Record<string, unknown> {
    return Object.fromEntries(visibleEntries(item as Record<string, unknown>));
}
