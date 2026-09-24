/**
 * A project's short key, which task keys are built from.
 *
 * Upper-case so a code is never mistaken for a board slug, 2–12 characters,
 * starting with a letter. A trailing digit-only segment is allowed, because
 * `PRJ-0002` already exists and forbidding it would make every task in those
 * projects unaddressable — see `parseTaskKey` for why that costs nothing.
 */
export const PROJECT_CODE_PATTERN = /^[A-Z][A-Z0-9-]{1,11}$/;

export function isValidProjectCode(code: string): boolean {
    return PROJECT_CODE_PATTERN.test(code ?? '');
}

/** Words that add nothing to an abbreviation — "The Mall of Dhaka" is TMD's MD. */
const FILLER_WORDS = new Set(['A', 'AN', 'THE', 'OF', 'AND', 'FOR', 'TO', 'IN', 'ON', 'AT', 'BY', '&']);

/**
 * Proposes a code from a project's name, for the create form to prefill.
 *
 * Several words give their initials (`Warehouse Management System` → `WMS`),
 * a number is kept whole (`Phase 2 Rollout` → `P2R`), and a single word gives
 * its first four letters (`Mobile` → `MOBI`) — or all of it when it is five
 * characters or fewer (`ERP71`). Anything that cannot make a
 * valid code — a name written entirely in Bangla, say — returns `null`, and the
 * caller falls back to a numbered code. At most 10 characters, so the caller
 * has room to append a digit when the proposal is taken.
 */
export function suggestProjectCode(name: string): string | null {
    const words = (name ?? '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(Boolean);
    const meaningful = words.filter((word) => !FILLER_WORDS.has(word));
    const source = meaningful.length > 0 ? meaningful : words;
    if (source.length === 0) return null;

    let code =
        source.length === 1
            ? source[0].length <= 5 ? source[0] : source[0].slice(0, 4)
            : source.map((word) => (/^\d+$/.test(word) ? word : word[0])).join('');

    if (/^\d/.test(code)) code = `P${code}`;
    code = code.slice(0, 10);
    return isValidProjectCode(code) ? code : null;
}
