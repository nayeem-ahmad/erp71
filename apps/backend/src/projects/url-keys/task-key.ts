/**
 * A task's readable key: `<project code>-<reference>`.
 *
 * Composed at read time rather than stored, so it always reflects the project's
 * current code — and so changing a code does not have to rewrite every task row.
 */

export function composeTaskKey(code: string, reference: number): string {
    return `${code}-${reference}`;
}

/**
 * Splits on the **last** hyphen, because a project code may contain hyphens
 * (`D1-BR3`) and may itself end in a digit-only segment (`PRJ-0002`, which holds
 * 737 of production's 842 tasks). A first-hyphen split reads `D1-BR3-7` as
 * project `D1`, and no shape-based rule can separate `PRJ-0002` from a key — so
 * the tail is taken as the reference and the head is looked up as a code. A head
 * matching no project simply 404s; it is never re-split.
 */
export function parseTaskKey(key: string): { code: string; reference: number } | null {
    const at = (key ?? '').lastIndexOf('-');
    if (at <= 0) return null;

    const code = key.slice(0, at);
    const tail = key.slice(at + 1);
    if (!code || !/^\d+$/.test(tail)) return null;
    // `ERP--1` would otherwise read as code "ERP-" and reference 1. No real
    // code ends in a hyphen, and accepting one would let two spellings of the
    // same key resolve to the same task.
    if (code.endsWith('-')) return null;

    const reference = Number(tail);
    if (!Number.isSafeInteger(reference) || reference < 1) return null;
    return { code, reference };
}
