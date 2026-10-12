/**
 * The plan behind fix-imported-codes.ts — pure, so the backend suite can test
 * it (apps/backend/src/external-sync/fix-imported-codes.spec.ts).
 *
 * Before 2026-10-11 the Express Retail / Dizi import wrote `EXT-<row id>` for a
 * product or customer with no code of its own, kept a GUID-like provider code
 * as it was, and added `-<row id>` to a code or supplier name it had already
 * claimed in the run. Dizi's row ids are GUIDs, so all three came out long. The
 * import now writes the next code in the tenant's series instead, `-2` on a
 * repeated code and `(2)` on a repeated name; this plans the same for records
 * already imported.
 */

export interface ImportedRecord {
    id: string;
    /** The provider's row id, from the import's mapping. */
    externalId: string;
    /** The SKU, customer code or supplier name the import wrote. */
    value: string;
}

export interface Rename {
    id: string;
    from: string;
    to: string;
}

const READABLE_CODE_MAX = 20;
const HEX_ID = /^(?=.*[a-f])[0-9a-f]{16,}$/i;

/**
 * A code a person would type, else null. The same rule as `readableCode` in
 * apps/backend/src/external-sync/external-sync.mapper.ts — the spec holds the
 * two together.
 */
export function readableCode(raw: string | null | undefined): string | null {
    const code = (raw ?? '').trim();
    if (!code || code.length > READABLE_CODE_MAX || HEX_ID.test(code.replaceAll('-', ''))) return null;
    return code;
}

/** `value` with the import's `-<row id>` taken off, when another record holds what is left. */
function repeatedFrom(record: ImportedRecord, held: ReadonlySet<string>): string | null {
    const suffix = `-${record.externalId}`;
    if (!record.value.endsWith(suffix)) return null;
    const base = record.value.slice(0, -suffix.length);
    return base && held.has(base) ? base : null;
}

/** The first of `variant(2)`, `variant(3)`, … no record holds; holds it. */
function firstFree(held: Set<string>, variant: (n: number) => string): string {
    let n = 2;
    while (held.has(variant(n))) n += 1;
    const value = variant(n);
    held.add(value);
    return value;
}

/**
 * New SKUs or customer codes for one tenant's imported records. `held` is
 * every value the column holds in the tenant, deleted rows included (the
 * unique index spans them); it gains each code planned, so no two collide.
 */
export function planCodeRenames(records: readonly ImportedRecord[], held: Set<string>, prefix: string): Rename[] {
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(\\d+)$`);
    let next = 1;
    for (const value of held) {
        const match = pattern.exec(value);
        if (match) next = Math.max(next, Number(match[1]) + 1);
    }
    const fromSeries = () => {
        let code = `${prefix}${String(next).padStart(5, '0')}`;
        while (held.has(code)) {
            next += 1;
            code = `${prefix}${String(next).padStart(5, '0')}`;
        }
        next += 1;
        held.add(code);
        return code;
    };

    const renames: Rename[] = [];
    for (const record of records) {
        let to: string | null = null;
        const base = repeatedFrom(record, held);
        if (/^EXT-/i.test(record.value)) to = fromSeries();
        else if (base && readableCode(base)) to = firstFree(held, (n) => `${base}-${n}`);
        else if (!readableCode(record.value)) to = fromSeries();
        if (to) renames.push({ id: record.id, from: record.value, to });
    }
    return renames;
}

/** New names for one tenant's imported suppliers whose name the import repeated with `-<row id>`. */
export function planNameRenames(records: readonly ImportedRecord[], held: Set<string>): Rename[] {
    const renames: Rename[] = [];
    for (const record of records) {
        const base = repeatedFrom(record, held);
        if (base) renames.push({ id: record.id, from: record.value, to: firstFree(held, (n) => `${base} (${n})`) });
    }
    return renames;
}
