/**
 * Bijoy (ANSI / SutonnyMJ "MJ" fonts) <-> Unicode Bangla converter.
 *
 * Background
 * ----------
 * Bijoy-era Bangla text is not Unicode. It is plain Latin-1 / Windows-1252
 * text that *looks* like Bangla only because an MJ font (SutonnyMJ etc.)
 * draws Bangla glyphs over the Latin code points. Three things make
 * converting it harder than a character table lookup:
 *
 *  1. Glyphs, not letters. Many single code points are whole conjuncts
 *     (`¶` = ক্ষ, `Á` = জ্ঞ), and some are half-forms (`¯` = স্, `Í` = ্ত)
 *     that only make sense next to each other.
 *  2. Visual order. Bijoy stores text in the order it is drawn: the
 *     pre-base vowel signs ি ে ৈ come *before* their consonant cluster, and
 *     the reph (র্, glyph `©`) comes *after* the cluster it sits on. Unicode
 *     stores logical order: cluster first, then ি/ে/ৈ; র্ before the cluster.
 *  3. Split vowels. ো and ৌ are drawn as ে…া and ে…ৗ around the consonant.
 *
 * Approach
 * --------
 * Bijoy -> Unicode (`bijoyToUnicode`):
 *   a. Tokenise with longest-match against `BIJOY_TABLE` (so `Av` beats `A`,
 *      `¯Í` beats `¯`, `||` beats `|`). The reph becomes a private-use
 *      placeholder so later passes can find it unambiguously.
 *   b. Collapse doubled hasants: half-form + subscript glyph pairs such as
 *      `¯` (স্) + `Í` (্ত) yield স্্ত, which is really স্ত.
 *   c. Move every pre-base sign (ি ে ৈ) to after the consonant cluster that
 *      follows it. A cluster is C(়)?(্C(়)?)* — so ্য and ্র are included.
 *   d. Move every reph placeholder to before the cluster it follows
 *      (skipping back over any vowel signs between them) and emit র্.
 *   e. Move a chandrabindu typed before its vowel sign (`Puv`` চঁাদ) behind
 *      it, then NFC-normalise (which also fuses ে+া -> ো and ে+ৗ -> ৌ).
 *
 * Unicode -> Bijoy (`unicodeToBijoy`) is the inverse:
 *   a. NFD-normalise (splits ো/ৌ into ে+া / ে+ৗ, and ড় ঢ় য় into base+়).
 *   b. Move each reph (র্ before a consonant) to after its cluster.
 *   c. Move each pre-base sign in front of its cluster (and reph).
 *   d. Longest-match against the reverse table built from `BIJOY_TABLE`,
 *      which prefers the single conjunct glyph where one exists, falling
 *      back to consonant + `&` (explicit hasant) where none does.
 *
 * Known limits
 * ------------
 * A converter of this kind is roughly 99% right on real documents. Things
 * that may need a hand fix:
 *  - MJ fonts have several glyph variants for the same sign (`y`/`z`/`“`/`æ`
 *    for ু, `‡`/`†` for ে, `Ö`/`ª`/`«` for ্র ...). All variants are read, but
 *    `unicodeToBijoy` always writes one canonical variant, so a round trip
 *    Bijoy -> Unicode -> Bijoy can change which variant is used (the Unicode
 *    text is stable).
 *  - A handful of rarely-used glyph slots (`¹`, `Ð`, `ÿ`) have no agreed
 *    meaning across MJ fonts and are left as-is.
 *  - Text that was English inside a Bijoy document cannot be told apart from
 *    Bangla and is converted too; likewise ASCII letters inside Unicode text
 *    pass through `unicodeToBijoy` unchanged and will render as Bangla in an
 *    MJ font.
 *  - Badly typed Bijoy (a reph or pre-base sign with no consonant next to it)
 *    is left in place rather than guessed at.
 *  - U+E000 (private use) is used internally as the reph placeholder; input
 *    containing it is not supported.
 */

// ---------------------------------------------------------------------------
// Mapping table
// ---------------------------------------------------------------------------

/** Placeholder for the reph (র্) while reordering. Private-use code point. */
const REPH = '';
const HASANT = '্';
const NUKTA = '়';
const ZWJ = '‍';

/**
 * `F` = forward only (Bijoy -> Unicode): a glyph variant or half-form we read
 * but never write. `R` = reverse only (Unicode -> Bijoy).
 */
type Direction = 'F' | 'R';
type Entry = readonly [bijoy: string, unicode: string, only?: Direction];

/**
 * The SutonnyMJ mapping. Order matters only for the reverse direction: when
 * several Bijoy spellings map to the same Unicode, the first non-`F` entry is
 * the one `unicodeToBijoy` writes. Matching itself is always longest-first.
 */
const BIJOY_TABLE: readonly Entry[] = [
  // --- Independent vowels ---------------------------------------------------
  ['Av', 'আ'],
  ['A', 'অ'],
  ['B', 'ই'],
  ['C', 'ঈ'],
  ['D', 'উ'],
  ['E', 'ঊ'],
  ['F', 'ঋ'],
  ['G', 'এ'],
  ['H', 'ঐ'],
  ['I', 'ও'],
  ['J', 'ঔ'],
  ['J', 'ওৗ', 'R'], // NFD form of ঔ

  // --- Consonants -----------------------------------------------------------
  ['K', 'ক'],
  ['L', 'খ'],
  ['M', 'গ'],
  ['N', 'ঘ'],
  ['O', 'ঙ'],
  ['P', 'চ'],
  ['Q', 'ছ'],
  ['R', 'জ'],
  ['S', 'ঝ'],
  ['T', 'ঞ'],
  ['U', 'ট'],
  ['V', 'ঠ'],
  ['W', 'ড'],
  ['X', 'ঢ'],
  ['Y', 'ণ'],
  ['Z', 'ত'],
  ['_', 'থ'],
  ['`', 'দ'],
  ['a', 'ধ'],
  ['b', 'ন'],
  ['c', 'প'],
  ['d', 'ফ'],
  ['e', 'ব'],
  ['f', 'ভ'],
  ['g', 'ম'],
  ['h', 'য'],
  ['i', 'র'],
  ['j', 'ল'],
  ['k', 'শ'],
  ['l', 'ষ'],
  ['m', 'স'],
  ['n', 'হ'],
  // ড় ঢ় য় are NFC composition exclusions, so the decomposed form IS NFC.
  ['o', 'ড' + NUKTA],
  ['p', 'ঢ' + NUKTA],
  ['q', 'য' + NUKTA],
  ['r', 'ৎ'],
  ['s', 'ং'],
  ['t', 'ঃ'],
  ['u', 'ঁ'],

  // --- Vowel signs (kar) ----------------------------------------------------
  ['v', 'া'],
  ['w', 'ি'], // pre-base
  ['x', 'ী'],
  ['y', 'ু'],
  ['z', 'ু', 'F'], // ু variant
  ['“', 'ু', 'F'], // ু variant (e.g. `ª“` দ্রু)
  ['æ', 'ু', 'F'], // ু variant used under র shapes (`iæ` রু)
  ['~', 'ূ'],
  ['ƒ', 'ূ', 'F'], // ূ variant used under র shapes (`iƒ` রূ)
  ['…', 'ৃ'],
  ['„', 'ৃ', 'F'], // ৃ variant
  ['‡', 'ে'], // pre-base
  ['†', 'ে', 'F'], // pre-base, variant
  ['ˆ', 'ৈ'], // pre-base
  ['‰', 'ৈ', 'F'], // pre-base, variant
  ['Š', 'ৗ'], // au length mark: ‡…Š = ৌ

  // --- Consonant + vowel ligatures ------------------------------------------
  ['¸', 'গু'],
  ['ï', 'শু'],
  ['û', 'হু'],
  ['ü', 'হৃ'],
  ['iæ', 'রু'],
  ['iƒ', 'রূ'],
  ['i¨', 'র' + ZWJ + HASANT + 'য'], // র‍্য (ra + ya-phala, as in র‍্যাব)

  // --- Conjunct glyphs (single code point or fixed pair) --------------------
  ['°', 'ক্ক'],
  ['±', 'ক্ট'],
  ['²', 'ক্ষ্ম'],
  ['³', 'ক্ত'],
  // NOTE: some converter tables list ´ as জ্ঞ; in SutonnyMJ ´ is ক্ম and জ্ঞ is Á.
  ['´', 'ক্ম'],
  ['µ', 'ক্র'],
  ['¶', 'ক্ষ'],
  ['·', 'ক্স'],
  ['K¡', 'ক্ব'],
  ['K¬', 'ক্ল'],
  ['º', 'গ্দ'],
  ['»', 'গ্ধ'],
  ['Mœ', 'গ্ন'],
  ['M¥', 'গ্ম'],
  ['Mø', 'গ্ল'],
  ['¼', 'ঙ্ক'],
  ['½', 'ঙ্গ'],
  ['•¶', 'ঙ্ক্ষ'],
  ['•L', 'ঙ্খ'],
  ['•N', 'ঙ্ঘ'],
  ['”P', 'চ্চ'],
  ['”Q¡', 'চ্ছ্ব'],
  ['”Q', 'চ্ছ'],
  ['”T', 'চ্ঞ'],
  ['¾¡', 'জ্জ্ব'],
  ['¾', 'জ্জ'],
  ['À', 'জ্ঝ'],
  ['Á', 'জ্ঞ'],
  ['R¡', 'জ্ব'],
  ['Â', 'ঞ্চ'],
  ['Ã', 'ঞ্ছ'],
  ['Ä', 'ঞ্জ'],
  ['Å', 'ঞ্ঝ'],
  ['Æ', 'ট্ট'],
  ['U¡', 'ট্ব'],
  ['U¥', 'ট্ম'],
  ['Ç', 'ড্ড'],
  ['È', 'ণ্ট'],
  ['É', 'ণ্ঠ'],
  ['Ê', 'ণ্ড'],
  ['Y^', 'ণ্ব'],
  ['Ë¡', 'ত্ত্ব'],
  ['Ë', 'ত্ত'],
  ['Ì', 'ত্থ'],
  ['Î', 'ত্র'],
  ['Zœ', 'ত্ন'],
  ['Z¥', 'ত্ম'],
  ['Z¡', 'ত্ব'],
  ['_¡', 'থ্ব'],
  ['˜M', 'দ্গ'],
  ['˜N', 'দ্ঘ'],
  ['Ï', 'দ্দ'],
  ['×', 'দ্ধ'],
  ['Ø', 'দ্ব'],
  ['˜¡', 'দ্ব', 'F'],
  ['™¢', 'দ্ভ'],
  ['Ù', 'দ্ম'],
  ['aŸ', 'ধ্ব'],
  ['a¥', 'ধ্ম'],
  ['›U', 'ন্ট'],
  ['Ú', 'ন্ঠ'],
  ['Û', 'ন্ড'],
  ['š¿', 'ন্ত্র'],
  ['š‘', 'ন্তু'],
  ['š—¡', 'ন্ত্ব'],
  ['šÍ', 'ন্ত'],
  ['š—', 'ন্ত', 'F'],
  ['š’', 'ন্থ'],
  ['›Ø', 'ন্দ্ব'],
  ['›`', 'ন্দ'],
  ['Ü', 'ন্ধ'],
  ['bœ', 'ন্ন'],
  ['š^', 'ন্ব'],
  ['b¥', 'ন্ম'],
  ['Ý', 'ন্স'],
  ['Þ', 'প্ট'],
  ['ß', 'প্ত'],
  ['cœ', 'প্ন'],
  ['à', 'প্প'],
  ['cø', 'প্ল'],
  ['á', 'প্স'],
  ['d¬', 'ফ্ল'],
  ['â', 'ব্জ'],
  ['ã', 'ব্দ'],
  ['ä', 'ব্ধ'],
  ['eŸ', 'ব্ব'],
  ['eø', 'ব্ল'],
  ['å', 'ভ্র'],
  ['gœ', 'ম্ন'],
  ['¤ú', 'ম্প'],
  ['ç', 'ম্ফ'],
  ['¤^', 'ম্ব'],
  ['¤£', 'ম্ভ্র'],
  ['¤¢', 'ম্ভ'],
  ['¤§', 'ম্ম'],
  ['¤ø', 'ম্ল'],
  ['é', 'ল্ক'],
  ['ê', 'ল্গ'],
  ['ë', 'ল্ট'],
  ['ì', 'ল্ড'],
  ['í', 'ল্প'],
  ['î', 'ল্ফ'],
  ['j¦', 'ল্ব'],
  ['j¥', 'ল্ম'],
  ['jø', 'ল্ল'],
  ['ð', 'শ্চ'],
  ['ñ', 'শ্ছ'],
  ['kœ', 'শ্ন'],
  ['k¦', 'শ্ব'],
  ['k¥', 'শ্ম'],
  ['kø', 'শ্ল'],
  ['®Œ', 'ষ্ক্র'],
  ['®‹', 'ষ্ক'],
  ['ó', 'ষ্ট'],
  ['ô', 'ষ্ঠ'],
  ['ò', 'ষ্ণ'],
  ['®ú', 'ষ্প'],
  ['õ', 'ষ্ফ'],
  ['®§', 'ষ্ম'],
  ['¯Œ', 'স্ক্র'],
  ['¯‹', 'স্ক'],
  ['ö', 'স্খ'],
  ['÷', 'স্ট'],
  ['¯¿', 'স্ত্র'],
  ['¯Í', 'স্ত'],
  ['¯—', 'স্ত', 'F'],
  // NOTE: some tables list ¿ as স্থ; in SutonnyMJ স্থ is ¯’ and ¿ is ্ত্র.
  ['¯’', 'স্থ'],
  ['¯œ', 'স্ন'],
  ['¯ú', 'স্প'],
  ['ù', 'স্ফ'],
  ['¯^', 'স্ব'],
  ['¯§', 'স্ম'],
  ['¯ø', 'স্ল'],
  ['nè', 'হ্ণ'],
  ['ý', 'হ্ন'],
  ['þ', 'হ্ম'],
  ['nŸ', 'হ্ব'],
  ['n¬', 'হ্ল'],

  // --- Half-forms (consonant + hasant drawn before a subscript glyph) -------
  ['¯', 'স্', 'F'],
  ['š', 'ন্', 'F'],
  ['›', 'ন্', 'F'],
  ['¤', 'ম্', 'F'],
  ['®', 'ষ্', 'F'],
  ['˜', 'দ্', 'F'],
  ['™', 'দ্', 'F'],
  ['•', 'ঙ্', 'F'],
  ['”', 'চ্', 'F'],

  // --- Subscript forms (phala) ----------------------------------------------
  ['¨', '্য'], // ya-phala
  ['Ö', '্র'], // ra-phala (the usual SutonnyMJ form, e.g. `cÖ` প্র)
  ['ª', '্র', 'F'], // ra-phala variant
  ['«', '্র', 'F'], // ra-phala variant
  ['¥', '্ম'],
  ['§', '্ম', 'F'],
  ['œ', '্ন'],
  ['ø', '্ল'],
  ['¬', '্ল', 'F'],
  ['­', '্ল', 'F'], // soft hyphen slot is a ্ল variant in MJ fonts
  ['¡', '্ব'],
  ['Ÿ', '্ব', 'F'],
  ['^', '্ব', 'F'],
  ['¦', '্ব', 'F'],
  ['Í', '্ত', 'F'],
  ['—', '্ত', 'F'],
  ['‹', '্ক', 'F'],
  ['Œ', '্ক্র', 'F'],
  ['’', '্থ', 'F'],
  ['‘', '্তু', 'F'],
  ['¿', '্ত্র', 'F'],
  ['ú', '্প', 'F'],
  ['è', '্ণ', 'F'],
  ['¢', '্ভ', 'F'],
  ['£', '্ভ্র', 'F'],

  // --- Marks ----------------------------------------------------------------
  ['&', HASANT], // explicit hasant / link
  ['©', REPH], // reph (র্), reordered later

  // --- Digits ---------------------------------------------------------------
  ['0', '০'],
  ['1', '১'],
  ['2', '২'],
  ['3', '৩'],
  ['4', '৪'],
  ['5', '৫'],
  ['6', '৬'],
  ['7', '৭'],
  ['8', '৮'],
  ['9', '৯'],

  // --- Punctuation ----------------------------------------------------------
  ['||', '॥'],
  ['|', '।'],
  ['Ò', '“'],
  ['Ó', '”'],
  ['Ô', '‘'],
  ['Õ', '’'],
  ['Ñ', '–'], // SutonnyMJ dash
];

// ---------------------------------------------------------------------------
// Lookup maps
// ---------------------------------------------------------------------------

interface MatchTable {
  readonly map: ReadonlyMap<string, string>;
  readonly maxLen: number;
}

function buildTable(pairs: Iterable<readonly [string, string]>): MatchTable {
  const map = new Map<string, string>();
  let maxLen = 1;
  for (const [from, to] of pairs) {
    if (map.has(from)) continue; // first entry wins
    map.set(from, to);
    maxLen = Math.max(maxLen, from.length);
  }
  return { map, maxLen };
}

const FORWARD = buildTable(
  BIJOY_TABLE.filter(([, , only]) => only !== 'R').map(([b, u]) => [b, u] as const),
);

const REVERSE = buildTable(
  BIJOY_TABLE.filter(([, , only]) => only !== 'F').map(([b, u]) => [u, b] as const),
);

/** Every non-ASCII character Bijoy uses for a Bangla glyph. */
const BIJOY_GLYPH_CHARS: ReadonlySet<string> = new Set(
  BIJOY_TABLE.flatMap(([b]) => [...b]).filter((ch) => ch.charCodeAt(0) > 0x7f),
);

/** Longest-match substitution; characters with no mapping pass through. */
function substitute(input: string, { map, maxLen }: MatchTable): string {
  let out = '';
  let i = 0;
  while (i < input.length) {
    let matched = false;
    for (let len = Math.min(maxLen, input.length - i); len > 0; len--) {
      const hit = map.get(input.substr(i, len));
      if (hit !== undefined) {
        out += hit;
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += input[i];
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reordering patterns (on Unicode text)
// ---------------------------------------------------------------------------

/** A Bangla consonant (ক–হ plus ড় ঢ় য়). */
const CONSONANT = '[\\u0995-\\u09B9\\u09DC\\u09DD\\u09DF]';
/** A consonant cluster: C(়)? followed by any number of (ZWJ?)্C(়)?. */
const CLUSTER = `${CONSONANT}${NUKTA}?(?:${ZWJ}?${HASANT}${CONSONANT}${NUKTA}?)*`;
/** Dependent vowel signs া … ৌ and the au length mark ৗ. */
const VOWEL_SIGNS = '[\\u09BE-\\u09CC\\u09D7]';
const PRE_BASE = '[\\u09BF\\u09C7\\u09C8]';

// Bijoy -> Unicode
const FWD_PRE_BASE = new RegExp(`(${PRE_BASE})(${CLUSTER})`, 'g');
const FWD_REPH = new RegExp(`(${CLUSTER})(${VOWEL_SIGNS}*)${REPH}`, 'g');
const FWD_CHANDRABINDU = new RegExp(`\\u0981(${VOWEL_SIGNS}+)`, 'g');

// Unicode -> Bijoy. The lookbehind keeps ্র্য (ra-phala + ya-phala) intact.
const REV_REPH = new RegExp(`(?<!${HASANT})\\u09B0${HASANT}(${CLUSTER})`, 'g');
const REV_PRE_BASE = new RegExp(`(${CLUSTER})(${REPH}?)(${PRE_BASE})`, 'g');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert Bijoy (SutonnyMJ ANSI) text to NFC-normalised Unicode Bangla. */
export function bijoyToUnicode(input: string): string {
  if (!input) return '';
  let s = substitute(input, FORWARD);
  // Half-form + subscript glyph pairs (¯ + Í) produce a doubled hasant.
  s = s.replace(/্+/g, HASANT);
  // ি ে ৈ go after the cluster they were drawn in front of.
  s = s.replace(FWD_PRE_BASE, '$2$1');
  // Reph goes in front of the cluster it was drawn after.
  s = s.replace(FWD_REPH, `র${HASANT}$1$2`);
  // Any reph left with no cluster before it is emitted where it stood.
  s = s.split(REPH).join(`র${HASANT}`);
  // চঁা -> চাঁ (chandrabindu typed before its vowel sign).
  s = s.replace(FWD_CHANDRABINDU, '$1ঁ');
  // ে+া -> ো and ে+ৗ -> ৌ (NFC would also do this; explicit for clarity).
  s = s.replace(/ো/g, 'ো').replace(/ৌ/g, 'ৌ');
  return s.normalize('NFC');
}

/** Convert Unicode Bangla to Bijoy (SutonnyMJ ANSI) text. */
export function unicodeToBijoy(input: string): string {
  if (!input) return '';
  // NFD splits ো/ৌ into ে+া/ে+ৗ and ড় ঢ় য় into base + nukta.
  let s = input.normalize('NFD');
  // Reph goes after the cluster it sits on.
  s = s.replace(REV_REPH, `$1${REPH}`);
  // ি ে ৈ go in front of their cluster (and its reph).
  s = s.replace(REV_PRE_BASE, '$3$1$2');
  s = substitute(s, REVERSE);
  s = s.split(REPH).join('©');
  // Joiners mean nothing to an MJ font.
  return s.replace(/[‌‍]/g, '');
}

/** True when the text contains any character from the Bengali block. */
export function containsBanglaUnicode(input: string): boolean {
  return /[ঀ-৿]/.test(input);
}

/**
 * Heuristic: does this text look like Bijoy-encoded Bangla?
 *
 * Returns false if the text contains any Unicode Bangla. Otherwise it scores
 * four independent signals and needs at least two of them:
 *
 *  1. Glyph density — at least 5% of letter-like characters are the
 *     non-ASCII characters Bijoy uses for Bangla glyphs (‡ ˆ Š © ¨ Ö ¯ ...).
 *  2. Kar density — `v` (া) and `w` (ি) make up at least 8% of ASCII
 *     letters. They are the commonest Bijoy letters but rare in English.
 *  3. Internal capitals — at least 20% of words have a capital after the
 *     first character (`UvKv`, `KvR`), which English almost never does.
 *  4. Vowel-less words — at least 40% of words with letters contain none of
 *     a e i o u (`Kg©x`, `Ggb`); English words nearly always have one.
 *
 * Signal 2 counts double when it is very strong (≥ 25% over ≥ 12 letters).
 * Short ASCII-only Bijoy fragments (a single word like `Avgvi`) can still
 * read as false; accented European text has glyph density but no other
 * signal, so it reads as false too.
 */
export function looksLikeBijoy(input: string): boolean {
  if (!input || containsBanglaUnicode(input)) return false;

  let asciiLetters = 0;
  let glyphs = 0;
  let kars = 0;
  for (const ch of input) {
    if (/[A-Za-z]/.test(ch)) {
      asciiLetters++;
      if (ch === 'v' || ch === 'w') kars++;
    } else if (BIJOY_GLYPH_CHARS.has(ch)) {
      glyphs++;
    }
  }
  const letterish = asciiLetters + glyphs;
  if (letterish < 2) return false;

  const words = input
    .split(/[\s,.;:!?()"'/\\-]+/)
    .filter((w) => /[A-Za-z]/.test(w) || [...w].some((c) => BIJOY_GLYPH_CHARS.has(c)));
  const wordCount = Math.max(words.length, 1);
  const internalCaps = words.filter((w) => /.[A-Z]/u.test(w)).length / wordCount;
  const vowelless = words.filter((w) => !/[aeiouAEIOU]/.test(w)).length / wordCount;

  const glyphRatio = glyphs / letterish;
  const karRatio = asciiLetters ? kars / asciiLetters : 0;

  let signals = 0;
  if (glyphRatio >= 0.05) signals++;
  if (karRatio >= 0.08) signals++;
  if (karRatio >= 0.25 && asciiLetters >= 12) signals++;
  if (internalCaps >= 0.2) signals++;
  if (vowelless >= 0.4) signals++;
  return signals >= 2;
}
