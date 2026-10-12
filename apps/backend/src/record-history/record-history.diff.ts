import { Prisma } from '@prisma/client';
import type { RecordHistoryChange } from '@erp71/shared-types';

/**
 * Pure helpers that turn Prisma rows into stored snapshots and compare two of
 * them. Kept free of Nest and the database so the rules can be tested directly.
 *
 * Snapshot conventions the diff relies on:
 *  - keys starting with `_` are bookkeeping, never shown as a change;
 *  - an array whose items carry `_key` is a set of lines matched by that key,
 *    not by position — a sale edit deletes and re-creates its items, so ids and
 *    order both move while the line is still the same product;
 *  - `_label` names a keyed item in a path, e.g. `items[Rice 5kg].quantity`.
 */

type Plain = Record<string, unknown>;

/** Decimal → number, Date → ISO string, undefined keys dropped, recursively. */
export function normalizeSnapshot<T = Plain>(value: unknown): T {
    return normalize(value) as T;
}

function normalize(value: unknown): unknown {
    if (value === null || value === undefined) return value ?? null;
    if (Prisma.Decimal.isDecimal(value)) return Number((value as Prisma.Decimal).toString());
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === 'object') {
        const out: Plain = {};
        for (const [key, nested] of Object.entries(value as Plain)) {
            if (nested === undefined) continue;
            out[key] = normalize(nested);
        }
        return out;
    }
    return value;
}

function isPlainObject(value: unknown): value is Plain {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isKeyedArray(value: unknown): value is Plain[] {
    return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item) && '_key' in item);
}

function isBookkeeping(key: string): boolean {
    return key.startsWith('_');
}

/** A keyed item without its bookkeeping keys, for an added/removed line. */
function stripBookkeeping(item: Plain): Plain {
    const out: Plain = {};
    for (const [key, value] of Object.entries(item)) {
        if (!isBookkeeping(key)) out[key] = value;
    }
    return out;
}

function same(a: unknown, b: unknown): boolean {
    if ((a ?? null) === null && (b ?? null) === null) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
    return JSON.stringify(a) === JSON.stringify(b);
}

function join(prefix: string, key: string): string {
    return prefix ? `${prefix}.${key}` : key;
}

/** Field-level differences between two normalized snapshots, in document order. */
export function diffSnapshots(before: unknown, after: unknown, prefix = ''): RecordHistoryChange[] {
    if (isPlainObject(before) && isPlainObject(after)) {
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
        return keys
            .filter((key) => !isBookkeeping(key))
            .flatMap((key) => diffSnapshots(before[key], after[key], join(prefix, key)));
    }

    // A keyed list on either side — one side may be empty after the last line
    // was removed, or before the first was added.
    const keyedBefore = isKeyedArray(before) || (Array.isArray(before) && before.length === 0 && isKeyedArray(after));
    const keyedAfter = isKeyedArray(after) || (Array.isArray(after) && after.length === 0 && isKeyedArray(before));
    if (keyedBefore && keyedAfter) {
        return diffKeyedLists(before as Plain[], after as Plain[], prefix);
    }

    if (same(before, after)) return [];
    return [{ path: prefix, from: before ?? null, to: after ?? null }];
}

function diffKeyedLists(before: Plain[], after: Plain[], prefix: string): RecordHistoryChange[] {
    const label = (item: Plain) => `${prefix}[${String(item._label ?? item._key)}]`;
    const afterByKey = new Map(after.map((item) => [String(item._key), item]));
    const beforeKeys = new Set(before.map((item) => String(item._key)));
    const changes: RecordHistoryChange[] = [];

    for (const item of before) {
        const match = afterByKey.get(String(item._key));
        if (!match) {
            changes.push({ path: label(item), from: stripBookkeeping(item), to: null });
        } else {
            changes.push(...diffSnapshots(item, match, label(match)));
        }
    }
    for (const item of after) {
        if (!beforeKeys.has(String(item._key))) {
            changes.push({ path: label(item), from: null, to: stripBookkeeping(item) });
        }
    }
    return changes;
}

/**
 * Give each line in a list a stable `_key` from `keyOf`, numbering repeats so
 * two lines of the same product stay two lines rather than collapsing to one.
 */
export function keyLines<T extends Plain>(
    lines: T[],
    keyOf: (line: T) => string,
    labelOf: (line: T) => string,
): (T & { _key: string; _label: string })[] {
    const seen = new Map<string, number>();
    return lines.map((line) => {
        const base = keyOf(line);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        const suffix = n > 1 ? ` #${n}` : '';
        return { _key: `${base}${suffix}`, _label: `${labelOf(line)}${suffix}`, ...line };
    });
}
