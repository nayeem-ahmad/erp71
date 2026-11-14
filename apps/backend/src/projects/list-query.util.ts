/**
 * Shared reading of list-filter query params.
 *
 * A single value stays a single value — `priority=URGENT` is what every
 * existing caller sends. A comma list is the multi-select the list pages add
 * on top, and an unknown token is dropped rather than failing the request.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function csv(value: string | undefined): string[] {
    if (!value) return [];
    return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
}

export function csvOf<T extends string>(value: string | undefined, allowed: readonly T[]): T[] {
    return csv(value).filter((part): part is T => (allowed as readonly string[]).includes(part));
}

export function csvIds(value: string | undefined): string[] {
    return csv(value).filter((part) => UUID.test(part));
}

export interface NumberParam {
    op: 'gt' | 'lt' | 'eq' | 'between';
    value: number;
    to?: number;
}

/** `gt:4`, `between:1,8` — the spelling the list number filter sends. */
export function parseNumberParam(raw: string | undefined): NumberParam | null {
    if (!raw) return null;
    const between = /^between:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw);
    if (between) return { op: 'between', value: Number(between[1]), to: Number(between[2]) };
    const simple = /^(gt|lt|eq):(-?\d+(?:\.\d+)?)$/.exec(raw);
    if (!simple) return null;
    const value = Number(simple[2]);
    return Number.isFinite(value) ? { op: simple[1] as NumberParam['op'], value } : null;
}

/**
 * One value keeps the equality the existing tests and callers assert.
 * Several become `{ in }`. Nothing is no clause.
 */
export function equalityOrIn(values: readonly string[]): string | { in: string[] } | undefined {
    if (values.length === 0) return undefined;
    if (values.length === 1) return values[0];
    return { in: [...values] };
}
