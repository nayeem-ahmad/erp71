import { normalizeName } from './normalize';

/**
 * Blocking: the rule that decides which products may even be compared.
 *
 * Brand-prefix drift ("Napa" vs "Square Napa") wants loose matching; strength
 * drift ("Napa 500mg" vs "Napa 665mg") demands the opposite, because those are
 * different medicines and merging them would bill stock and sales to the wrong
 * product. Blocking resolves the tension by making the strength and pack tokens
 * an exact precondition: two products share a block only when their measures
 * are identical, and similarity scoring then runs *within* a block, where the
 * loose part is safe.
 */

/** Canonical unit spellings. Keys are what we see; values are what we store. */
const UNIT_ALIASES: Record<string, string> = {
    mg: 'mg',
    milligram: 'mg',
    milligrams: 'mg',
    mcg: 'mcg',
    microgram: 'mcg',
    g: 'g',
    gm: 'g',
    gram: 'g',
    grams: 'g',
    kg: 'kg',
    ml: 'ml',
    millilitre: 'ml',
    milliliter: 'ml',
    l: 'l',
    ltr: 'l',
    litre: 'l',
    liter: 'l',
    iu: 'iu',
};

/** Words that mark a bare number as a pack count rather than a strength. */
const PACK_WORDS = new Set([
    's',
    'pc',
    'pcs',
    'piece',
    'pieces',
    'tab',
    'tabs',
    'cap',
    'caps',
    'strip',
    'strips',
]);

/** `500` not `500.0`, so "500 mg" and "500.0 mg" share a block. */
function trimNumber(value: string): string {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : value;
}

/**
 * Pulls every strength/pack measure out of a name, canonicalized so that
 * "500 mg", "500mg" and "৫০০ mg" all become `500mg`, and "10s", "10 pcs" and
 * "10 tabs" all become `10s`.
 */
export function extractMeasureTokens(name: string): string[] {
    const tokens = normalizeName(name).split(' ').filter(Boolean);
    const measures = new Set<string>();

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // "500mg" — number and unit fused into one token.
        const fused = token.match(/^(\d+(?:\.\d+)?)([a-z]+)$/);
        if (fused) {
            const [, value, rawUnit] = fused;
            const unit = UNIT_ALIASES[rawUnit];
            if (unit) {
                measures.add(`${trimNumber(value)}${unit}`);
                continue;
            }
            if (PACK_WORDS.has(rawUnit)) {
                measures.add(`${trimNumber(value)}s`);
                continue;
            }
        }

        // "500 mg" — number then unit as two tokens.
        const bare = token.match(/^(\d+(?:\.\d+)?)$/);
        if (bare) {
            const next = tokens[i + 1];
            if (next) {
                const unit = UNIT_ALIASES[next];
                if (unit) {
                    measures.add(`${trimNumber(bare[1])}${unit}`);
                    i++;
                    continue;
                }
                if (PACK_WORDS.has(next)) {
                    measures.add(`${trimNumber(bare[1])}s`);
                    i++;
                    continue;
                }
            }
        }
    }

    return [...measures].sort();
}

/**
 * The exact-match precondition. Products with different measures get different
 * keys and are never candidates for each other, whatever their string
 * similarity.
 */
export function blockKey(name: string): string {
    return extractMeasureTokens(name).join('|');
}

/** The descriptive remainder, which is what similarity actually scores. */
export function stripMeasureTokens(name: string): string {
    const tokens = normalizeName(name).split(' ').filter(Boolean);
    const kept: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        const fused = token.match(/^(\d+(?:\.\d+)?)([a-z]+)$/);
        if (fused && (UNIT_ALIASES[fused[2]] || PACK_WORDS.has(fused[2]))) continue;

        const bare = token.match(/^(\d+(?:\.\d+)?)$/);
        if (bare) {
            const next = tokens[i + 1];
            if (next && (UNIT_ALIASES[next] || PACK_WORDS.has(next))) {
                i++;
                continue;
            }
        }

        kept.push(token);
    }

    return kept.join(' ');
}
