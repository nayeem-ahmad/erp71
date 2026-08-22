/**
 * ICU-lite plural resolution for message catalogs.
 *
 * The platform's original interpolation was a bare `replaceAll` over `{token}`,
 * so any count-bearing string had to be hand-split into two keys
 * (`recipeCount` / `recipeCountPlural`) and the call site picked between them
 * with `count === 1`. That works for every locale whose plural rules are
 * one-or-other — en, bn, ms, hi, de, fr, es, ur — and is simply not expressible
 * in Arabic, which has six CLDR categories (zero, one, two, few, many, other).
 *
 * The fix is one string per key carrying its own branches:
 *
 *   en: '{count, plural, one {# recipe} other {# recipes}}'
 *   ar: '{count, plural, zero {لا وصفات} one {وصفة واحدة} two {وصفتان} ...}'
 *
 * One leaf per key means `catalog.test.ts` key parity still holds while each
 * locale supplies exactly the categories its language needs — an object keyed
 * by category would have made parity fail by design, since en needs two
 * branches and ar needs six.
 *
 * Only the `plural` argument type is implemented. `select`, `selectordinal`,
 * `number`/`date` skeletons and nested arguments are deliberately absent: the
 * catalogs do not use them, and a partial ICU parser that silently mangles
 * syntax it does not understand is worse than one with a stated boundary.
 */

const PLURAL_HEAD = /^\{\s*([A-Za-z0-9_]+)\s*,\s*plural\s*,/;

/** CLDR categories, plus the `=N` exact-match form ICU allows. */
export type PluralBranches = Record<string, string>;

/**
 * Index of the `}` that closes the `{` at `open`, or -1 when unbalanced.
 * Branch bodies contain their own `{token}` placeholders, so this has to count
 * depth rather than scan for the first `}`.
 */
function findMatchingBrace(source: string, open: number): number {
    let depth = 0;

    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') {
            depth += 1;
        } else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }

    return -1;
}

/** Parses `one {…} other {…}` into `{ one: '…', other: '…' }`. */
function parseBranches(body: string): PluralBranches {
    const branches: PluralBranches = {};
    let i = 0;

    while (i < body.length) {
        while (i < body.length && /\s/.test(body[i])) i += 1;
        if (i >= body.length) break;

        const keyStart = i;
        while (i < body.length && body[i] !== '{' && !/\s/.test(body[i])) i += 1;
        const key = body.slice(keyStart, i);
        if (!key) break;

        while (i < body.length && /\s/.test(body[i])) i += 1;
        if (body[i] !== '{') break;

        const close = findMatchingBrace(body, i);
        if (close === -1) break;

        branches[key] = body.slice(i + 1, close);
        i = close + 1;
    }

    return branches;
}

/**
 * CLDR plural category for `count` in `language`, falling back to the
 * one-or-other split if the runtime has no `Intl.PluralRules`. Takes the bare
 * language subtag (`ar`, not `ar-EG-u-nu-latn`) — plural selection ignores the
 * numbering-system extension, and passing the full tag only invites a
 * `RangeError` on a malformed one.
 */
export function selectPluralCategory(language: string, count: number): string {
    if (typeof Intl === 'undefined' || typeof Intl.PluralRules !== 'function') {
        return count === 1 ? 'one' : 'other';
    }

    try {
        return new Intl.PluralRules(language).select(count);
    } catch {
        return count === 1 ? 'one' : 'other';
    }
}

/**
 * Replaces every `{name, plural, …}` block in `template` with the branch that
 * matches `values[name]` under `language`.
 *
 * `#` inside a branch renders as `String(count)` rather than a locale-formatted
 * number, matching what `{count}` already does elsewhere in the catalogs.
 * Making them differ would mean two placeholders in the same sentence
 * formatting the same value two ways; real money and quantity formatting goes
 * through `formatBDT()` / `formatNumber()`, not through here.
 *
 * A block whose argument is missing, non-numeric, or malformed is emitted
 * verbatim, so a broken catalog string shows up in the UI as itself instead of
 * disappearing into an empty span.
 */
export function resolvePlurals(
    template: string,
    values: Record<string, string | number>,
    language: string,
): string {
    if (!template.includes('plural')) return template;

    let out = '';
    let i = 0;

    while (i < template.length) {
        const next = template.indexOf('{', i);
        if (next === -1) {
            out += template.slice(i);
            break;
        }

        out += template.slice(i, next);

        const close = findMatchingBrace(template, next);
        if (close === -1) {
            out += template.slice(next);
            break;
        }

        const block = template.slice(next, close + 1);
        const head = PLURAL_HEAD.exec(block);

        if (!head) {
            out += block;
            i = close + 1;
            continue;
        }

        const argument = head[1];
        const raw = values[argument];
        const count = typeof raw === 'number' ? raw : Number(raw);

        if (raw === undefined || Number.isNaN(count)) {
            out += block;
            i = close + 1;
            continue;
        }

        const branches = parseBranches(block.slice(head[0].length, -1));
        const chosen =
            branches[`=${count}`] ??
            branches[selectPluralCategory(language, count)] ??
            branches.other;

        // No `other` branch is a malformed string, not an empty one.
        out += chosen === undefined ? block : chosen.replaceAll('#', String(count));
        i = close + 1;
    }

    return out;
}
