# External-Sync Match Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace exact-string matching in the ERP importer with normalized, blocked, scored matching whose decisions a human confirms in a spreadsheet before any write.

**Architecture:** Four pure-function modules under `apps/backend/src/external-sync/match/` do normalization, blocking, scoring and candidate assembly. Two endpoints hand the candidates out as JSON and take decisions back. Decisions persist as `ExternalSyncMapping` rows — no new table. The browser writes and reads the XLSX using libraries already in the frontend.

**Tech Stack:** NestJS, Prisma, Jest (backend); Next.js 15, `xlsx` ^0.18.5, `papaparse` ^5.5.4 (frontend)

**Spec:** `docs/superpowers/specs/2026-09-21-external-sync-match-review-design.md`

## Global Constraints

- Backend tests run with `npm test --workspace apps/backend` (jest, `--testPathPatterns="src/"`). A single file: `npx jest --testPathPatterns="src/external-sync/match/normalize" --workspace apps/backend` — or from `apps/backend`, `npx jest src/external-sync/match/normalize`.
- **Do not add `xlsx` or any spreadsheet library to `apps/backend/package.json`.** All spreadsheet reading and writing happens in the browser. The backend speaks JSON only.
- New backend modules go under `apps/backend/src/external-sync/match/`. Do not add matching logic to `external-sync.service.ts` — it is already ~2000 lines.
- Every business query must be scoped to `tenant_id` (`TenantInterceptor` convention).
- All three adoption queries must carry `deleted_at: null`.
- Match modules are **pure functions** — no Prisma, no I/O, no `Date.now()`. Candidate assembly receives already-fetched rows as arguments.
- Money via `formatBDT()` in any UI; no literal `$`.
- UI follows `docs/ui-design-guidelines.md`: `PageShell` + `PageHeader`, `ModalShell` for modals, `blue-600` accent only, no `rounded-2xl`/`rounded-3xl`, `text-sm`/`text-xs` body, ≥44px touch targets.
- Commit after each task. Branch is `dev` — never commit to `main`.

---

## File Structure

| File | Responsibility |
|---|---|
| `match/normalize.ts` | **new** — NFC, Bengali digits, case/space/punctuation, corporate suffixes, phone |
| `match/blocking.ts` | **new** — extract strength/pack tokens, build block key |
| `match/score.ts` | **new** — token-set similarity, confidence tiers |
| `match/candidates.ts` | **new** — assemble candidate rows from mapped + existing records |
| `match/match.types.ts` | **new** — shared types for the above and the DTOs |
| `external-sync.match.dto.ts` | **new** — request/response DTOs for the two endpoints |
| `external-sync.match.service.ts` | **new** — fetch existing records, call `candidates`, persist decisions |
| `external-sync.service.ts` | **modify** — adoption consults mappings first; three fixes |
| `external-sync.controller.ts` | **modify** — two admin routes |
| `tenant-external-sync.controller.ts` | **modify** — two owner-gated routes |
| `external-sync.module.ts` | **modify** — register the match service |
| `lib/spreadsheet.ts` (frontend) | **modify** — optional `sheetName` |
| `lib/match-workbook.ts` (frontend) | **new** — build/parse the multi-sheet workbook |
| `settings/data/external-import/page.tsx` | **modify** — download/upload controls |
| `lib/api.ts` (frontend) | **modify** — two API calls |

---

## Task 1: Normalization primitives

**Files:**
- Create: `apps/backend/src/external-sync/match/normalize.ts`
- Test: `apps/backend/src/external-sync/match/normalize.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizeName(raw: string): string`
  - `normalizeCompanyName(raw: string): string`
  - `normalizePhone(raw: string | null): string | null`
  - `normalizeDigits(raw: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { normalizeName, normalizeCompanyName, normalizePhone, normalizeDigits } from './normalize';

describe('normalizeDigits', () => {
    it('converts Bengali digits to ASCII', () => {
        expect(normalizeDigits('৫০০')).toBe('500');
    });
    it('leaves ASCII digits alone', () => {
        expect(normalizeDigits('500')).toBe('500');
    });
});

describe('normalizeName', () => {
    it('case-folds, trims and collapses whitespace', () => {
        expect(normalizeName('  Napa   500MG  ')).toBe('napa 500mg');
    });
    it('strips punctuation', () => {
        expect(normalizeName('Napa-500 (mg).')).toBe('napa 500 mg');
    });
    it('normalizes Bengali digits inside a name', () => {
        expect(normalizeName('নাপা ৫০০')).toBe('নাপা 500');
    });
    it('is NFC-stable for decomposed Bengali', () => {
        const composed = 'ক্ষ';
        const decomposed = composed.normalize('NFD');
        expect(normalizeName(decomposed)).toBe(normalizeName(composed));
    });
    it('returns empty string for empty input', () => {
        expect(normalizeName('')).toBe('');
    });
});

describe('normalizeCompanyName', () => {
    it('strips a trailing Ltd', () => {
        expect(normalizeCompanyName('Beximco Pharma Ltd')).toBe('beximco pharma');
    });
    it('strips Limited and Pharmaceuticals is preserved', () => {
        expect(normalizeCompanyName('Beximco Pharmaceuticals Limited')).toBe('beximco pharmaceuticals');
    });
    it('strips Traders and & Sons', () => {
        expect(normalizeCompanyName('Towfiq Traders')).toBe('towfiq');
        expect(normalizeCompanyName('Karim & Sons')).toBe('karim');
    });
    it('does not strip a suffix word that is the whole name', () => {
        expect(normalizeCompanyName('Traders')).toBe('traders');
    });
});

describe('normalizePhone', () => {
    it.each([
        ['01712345678', '+8801712345678'],
        ['8801712345678', '+8801712345678'],
        ['+8801712345678', '+8801712345678'],
        ['01712-345678', '+8801712345678'],
        ['০১৭১২৩৪৫৬৭৮', '+8801712345678'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizePhone(input)).toBe(expected);
    });

    it('returns null for null, empty or unusable input', () => {
        expect(normalizePhone(null)).toBeNull();
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone('N/A')).toBeNull();
    });

    it('returns null for a number that is not a Bangladeshi mobile', () => {
        expect(normalizePhone('12345')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/external-sync/match/normalize`
Expected: FAIL — `Cannot find module './normalize'`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Text normalization shared by every matcher.
 *
 * Bangladeshi retail data arrives in two scripts and two digit systems, so a
 * comparison that does not normalize first will treat "নাপা ৫০০" and "Napa 500"
 * as unrelated — and, worse, treat the same Bengali word typed in composed and
 * decomposed form as two different suppliers.
 */

const BENGALI_ZERO = 0x09e6;

/** Bengali ০-৯ to ASCII 0-9. */
export function normalizeDigits(raw: string): string {
    return raw.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - BENGALI_ZERO));
}

/** Case-folded, NFC, ASCII-digit, punctuation-free, single-spaced. */
export function normalizeName(raw: string): string {
    if (!raw) return '';
    return normalizeDigits(raw.normalize('NFC'))
        .toLowerCase()
        // Keep letters (any script), digits and spaces; punctuation becomes a space
        // so "Napa-500" and "Napa 500" agree.
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * Suffixes that carry no identity — two suppliers differing only by "Ltd"
 * are one supplier. Ordered longest-first so "private limited" is consumed
 * before "limited".
 */
const COMPANY_SUFFIXES = [
    'private limited',
    'pvt ltd',
    'and sons',
    'company',
    'limited',
    'traders',
    'trading',
    'enterprise',
    'enterprises',
    'agency',
    'agencies',
    'sons',
    'corp',
    'inc',
    'ltd',
    'co',
];

/** `normalizeName` plus trailing corporate suffixes removed. */
export function normalizeCompanyName(raw: string): string {
    let name = normalizeName(raw);
    let changed = true;
    while (changed) {
        changed = false;
        for (const suffix of COMPANY_SUFFIXES) {
            if (name.endsWith(` ${suffix}`)) {
                // Never strip the name down to nothing: a supplier literally
                // called "Traders" keeps its name.
                const stripped = name.slice(0, -(suffix.length + 1)).trim();
                if (stripped) {
                    name = stripped;
                    changed = true;
                }
            }
        }
    }
    return name;
}

/**
 * Bangladeshi mobile numbers to `+8801XXXXXXXXX`.
 *
 * Phone is the only real identity a customer carries — the customer *code* is
 * generated by the provider, so it is not identity at all.
 */
export function normalizePhone(raw: string | null): string | null {
    if (!raw) return null;
    const digits = normalizeDigits(raw.normalize('NFC')).replace(/\D/g, '');
    if (!digits) return null;

    let local: string;
    if (digits.startsWith('880')) local = digits.slice(3);
    else if (digits.startsWith('0')) local = digits.slice(1);
    else local = digits;

    // A BD mobile is 1 followed by 9 digits once the country/trunk prefix is off.
    if (!/^1\d{9}$/.test(local)) return null;
    return `+880${local}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/external-sync/match/normalize`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync/match/normalize.ts apps/backend/src/external-sync/match/normalize.spec.ts
git commit -m "feat(external-sync): text normalization for match candidates

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Product blocking on strength and pack

This is the safety-critical module. Two products may only be compared when their strength and pack tokens are **identical**, so no similarity score can ever merge different dosages.

**Files:**
- Create: `apps/backend/src/external-sync/match/blocking.ts`
- Test: `apps/backend/src/external-sync/match/blocking.spec.ts`

**Interfaces:**
- Consumes: `normalizeName` from `./normalize`
- Produces:
  - `extractMeasureTokens(name: string): string[]` — sorted, deduped, e.g. `['500mg', '10s']` → `['10s', '500mg']`
  - `blockKey(name: string): string` — the measure tokens joined by `|`; `''` when none
  - `stripMeasureTokens(name: string): string` — normalized name minus the measures

- [ ] **Step 1: Write the failing test**

```ts
import { extractMeasureTokens, blockKey, stripMeasureTokens } from './blocking';

describe('extractMeasureTokens', () => {
    it('extracts a strength with an attached unit', () => {
        expect(extractMeasureTokens('Napa 500mg')).toEqual(['500mg']);
    });
    it('extracts a strength written with a space', () => {
        expect(extractMeasureTokens('Napa 500 mg')).toEqual(['500mg']);
    });
    it('extracts a pack count written as 10s', () => {
        expect(extractMeasureTokens('Napa 10s')).toEqual(['10s']);
    });
    it('treats "(10 pcs)" as the same pack token as "10s"', () => {
        expect(extractMeasureTokens('Napa (10 pcs)')).toEqual(['10s']);
    });
    it('returns tokens sorted so order in the name does not matter', () => {
        expect(extractMeasureTokens('Napa 500mg 10s')).toEqual(['10s', '500mg']);
        expect(extractMeasureTokens('Napa 10s 500mg')).toEqual(['10s', '500mg']);
    });
    it('normalizes Bengali digits in a measure', () => {
        expect(extractMeasureTokens('নাপা ৫০০ মিগ্রা 500mg')).toEqual(['500mg']);
    });
    it('returns an empty array when there is no measure', () => {
        expect(extractMeasureTokens('Hand Sanitizer')).toEqual([]);
    });
    it('handles ml and litre volumes', () => {
        expect(extractMeasureTokens('Savlon 100ml')).toEqual(['100ml']);
        expect(extractMeasureTokens('Savlon 1 litre')).toEqual(['1l']);
    });
});

describe('blockKey', () => {
    it('is identical for the same product written two ways', () => {
        expect(blockKey('Napa 500mg')).toBe(blockKey('Square Napa 500 mg'));
    });

    it('DIFFERS for different strengths — these must never be compared', () => {
        expect(blockKey('Napa 500mg')).not.toBe(blockKey('Napa 665mg'));
    });

    it('differs for different pack sizes', () => {
        expect(blockKey('Napa 500mg 10s')).not.toBe(blockKey('Napa 500mg 20s'));
    });

    it('groups all measureless products into one block', () => {
        expect(blockKey('Hand Sanitizer')).toBe('');
        expect(blockKey('Face Towel')).toBe('');
    });
});

describe('stripMeasureTokens', () => {
    it('removes the measures and leaves the descriptive words', () => {
        expect(stripMeasureTokens('Square Napa 500 mg 10s')).toBe('square napa');
    });
    it('leaves a measureless name as its normalized self', () => {
        expect(stripMeasureTokens('Hand Sanitizer')).toBe('hand sanitizer');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/external-sync/match/blocking`
Expected: FAIL — `Cannot find module './blocking'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { normalizeName } from './normalize';

/**
 * Blocking: the rule that decides which products may even be compared.
 *
 * Brand-prefix drift ("Napa" vs "Square Napa") wants loose matching; strength
 * drift ("Napa 500mg" vs "Napa 665mg") demands the opposite, because those are
 * different medicines. Blocking resolves the tension by making the strength and
 * pack tokens an exact precondition: two products share a block only when their
 * measures are identical, and similarity scoring then runs *within* a block
 * where the loose part is safe.
 */

/** Canonical unit spellings. Keys are what we see; values are what we store. */
const UNIT_ALIASES: Record<string, string> = {
    mg: 'mg',
    milligram: 'mg',
    milligrams: 'mg',
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
    mcg: 'mcg',
};

/** Words that mark a bare number as a pack count rather than a strength. */
const PACK_WORDS = new Set(['s', 'pc', 'pcs', 'piece', 'pieces', 'tab', 'tabs', 'cap', 'caps', 'strip', 'strips']);

/**
 * Pulls every strength/pack measure out of a name, canonicalized so that
 * "500 mg", "500mg" and "৫০০ mg" all become `500mg`, and "10s", "10 pcs" and
 * "10 tabs" all become `10s`.
 */
export function extractMeasureTokens(name: string): string[] {
    const normalized = normalizeName(name);
    const tokens = normalized.split(' ').filter(Boolean);
    const measures = new Set<string>();

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // "500mg" — number and unit fused.
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

        // "500 mg" — number then unit as separate tokens.
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

/** `500` not `500.0`, so "500 mg" and "500.0 mg" share a block. */
function trimNumber(value: string): string {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : value;
}

/**
 * The exact-match precondition. Products with different measures get
 * different keys and are never candidates for each other.
 */
export function blockKey(name: string): string {
    return extractMeasureTokens(name).join('|');
}

/** The descriptive remainder, which is what similarity actually scores. */
export function stripMeasureTokens(name: string): string {
    const normalized = normalizeName(name);
    const tokens = normalized.split(' ').filter(Boolean);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/external-sync/match/blocking`
Expected: PASS — in particular the "DIFFERS for different strengths" case

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync/match/blocking.ts apps/backend/src/external-sync/match/blocking.spec.ts
git commit -m "feat(external-sync): block products on strength and pack tokens

Napa 500mg and Napa 665mg can never be compared, whatever their string
similarity, because the measures are an exact precondition for candidacy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Similarity scoring and confidence tiers

**Files:**
- Create: `apps/backend/src/external-sync/match/score.ts`
- Test: `apps/backend/src/external-sync/match/score.spec.ts`

**Interfaces:**
- Consumes: nothing (operates on already-normalized strings)
- Produces:
  - `tokenSetSimilarity(a: string, b: string): number` — 0..1
  - `confidenceFor(score: number, candidateCount: number): Confidence`
  - `type Confidence = 'high' | 'medium' | 'low' | 'none'`
  - `HIGH_THRESHOLD = 0.85`, `MEDIUM_THRESHOLD = 0.45`

- [ ] **Step 1: Write the failing test**

```ts
import { tokenSetSimilarity, confidenceFor, HIGH_THRESHOLD, MEDIUM_THRESHOLD } from './score';

describe('tokenSetSimilarity', () => {
    it('is 1 for identical strings', () => {
        expect(tokenSetSimilarity('napa', 'napa')).toBe(1);
    });
    it('is 0 for no shared tokens', () => {
        expect(tokenSetSimilarity('napa', 'savlon')).toBe(0);
    });
    it('scores a missing brand prefix highly (subset)', () => {
        // "napa" ⊂ "square napa" — the containment case brand drift produces.
        expect(tokenSetSimilarity('napa', 'square napa')).toBeGreaterThanOrEqual(HIGH_THRESHOLD);
    });
    it('scores partial overlap between the thresholds', () => {
        const score = tokenSetSimilarity('beximco pharma', 'beximco healthcare');
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(HIGH_THRESHOLD);
    });
    it('is symmetric', () => {
        expect(tokenSetSimilarity('napa', 'square napa')).toBe(tokenSetSimilarity('square napa', 'napa'));
    });
    it('is 0 when either side is empty', () => {
        expect(tokenSetSimilarity('', 'napa')).toBe(0);
        expect(tokenSetSimilarity('napa', '')).toBe(0);
    });
});

describe('confidenceFor', () => {
    it('is high for a single strong candidate', () => {
        expect(confidenceFor(0.95, 1)).toBe('high');
    });
    it('downgrades a strong score to medium when several candidates tie', () => {
        expect(confidenceFor(0.95, 3)).toBe('medium');
    });
    it('is medium in the middle band', () => {
        expect(confidenceFor(0.6, 1)).toBe('medium');
    });
    it('is low below the medium threshold', () => {
        expect(confidenceFor(0.2, 1)).toBe('low');
    });
    it('is none with no candidates', () => {
        expect(confidenceFor(0, 0)).toBe('none');
    });
    it('treats the thresholds as inclusive lower bounds', () => {
        expect(confidenceFor(HIGH_THRESHOLD, 1)).toBe('high');
        expect(confidenceFor(MEDIUM_THRESHOLD, 1)).toBe('medium');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/external-sync/match/score`
Expected: FAIL — `Cannot find module './score'`

- [ ] **Step 3: Write minimal implementation**

```ts
export type Confidence = 'high' | 'medium' | 'low' | 'none';

/**
 * Tuned against the first real dry run rather than guessed — see the spec.
 * Raising HIGH sends more rows to review; lowering it auto-accepts more.
 */
export const HIGH_THRESHOLD = 0.85;
export const MEDIUM_THRESHOLD = 0.45;

/**
 * Overlap-weighted token similarity.
 *
 * Plain Jaccard punishes a missing brand prefix: {napa} vs {square, napa} is
 * 1/2. But containment is exactly the shape brand drift takes, so the score
 * blends Jaccard with the containment ratio (shared / smaller side), which
 * reads a subset as a near-match while still separating unrelated names.
 */
export function tokenSetSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(' ').filter(Boolean));
    const setB = new Set(b.split(' ').filter(Boolean));
    if (setA.size === 0 || setB.size === 0) return 0;

    let shared = 0;
    for (const token of setA) if (setB.has(token)) shared++;
    if (shared === 0) return 0;

    const union = setA.size + setB.size - shared;
    const jaccard = shared / union;
    const containment = shared / Math.min(setA.size, setB.size);

    return jaccard * 0.4 + containment * 0.6;
}

/**
 * Several near-equal candidates mean the machine cannot choose, however high
 * the top score — that is precisely a human's call, so it lands in `medium`.
 */
export function confidenceFor(score: number, candidateCount: number): Confidence {
    if (candidateCount === 0) return 'none';
    if (score >= HIGH_THRESHOLD) return candidateCount > 1 ? 'medium' : 'high';
    if (score >= MEDIUM_THRESHOLD) return 'medium';
    return 'low';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/external-sync/match/score`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync/match/score.ts apps/backend/src/external-sync/match/score.spec.ts
git commit -m "feat(external-sync): token-set similarity and confidence tiers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Candidate assembly

**Files:**
- Create: `apps/backend/src/external-sync/match/match.types.ts`
- Create: `apps/backend/src/external-sync/match/candidates.ts`
- Test: `apps/backend/src/external-sync/match/candidates.spec.ts`

**Interfaces:**
- Consumes: `normalizeName`, `normalizeCompanyName`, `normalizePhone`, `blockKey`, `stripMeasureTokens`, `tokenSetSimilarity`, `confidenceFor`
- Produces:
  - `type MatchEntity = 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER'`
  - `type MatchDecision = 'accept' | 'new' | 'alt1' | 'alt2' | 'alt3' | 'skip'`
  - `interface ExistingRecord { id: string; name: string; phone?: string | null; sku?: string | null }`
  - `interface CandidateRow { entity; externalId; source; sourceName; sourceExtra; suggestedMatch; matchId; confidence; score; altCandidates: string[]; altIds: string[]; decision: MatchDecision | ''; notes: string }`
  - `buildProductCandidates(sources, existing, source): CandidateRow[]`
  - `buildCustomerCandidates(sources, existing, source): CandidateRow[]`
  - `buildSupplierCandidates(sources, existing, source): CandidateRow[]`

- [ ] **Step 1: Write the failing test**

```ts
import { buildProductCandidates, buildCustomerCandidates, buildSupplierCandidates } from './candidates';
import type { ExistingRecord } from './match.types';

const SOURCE = 'ExpressRetail';

describe('buildProductCandidates', () => {
    const existing: ExistingRecord[] = [
        { id: 'p1', name: 'Square Napa 500 mg', sku: 'SKU-1' },
        { id: 'p2', name: 'Napa 665mg', sku: 'SKU-2' },
        { id: 'p3', name: 'Hand Sanitizer', sku: 'SKU-3' },
    ];

    it('matches across a brand prefix within the same block', () => {
        const [row] = buildProductCandidates([{ externalId: '1', name: 'Napa 500mg' }], existing, SOURCE);
        expect(row.matchId).toBe('p1');
        expect(row.confidence).toBe('high');
        expect(row.decision).toBe('accept');
    });

    it('NEVER matches a different strength', () => {
        const [row] = buildProductCandidates([{ externalId: '2', name: 'Napa 250mg' }], existing, SOURCE);
        expect(row.matchId).toBeNull();
        expect(row.confidence).toBe('none');
        expect(row.decision).toBe('new');
    });

    it('does not offer a measureless product as a candidate for a measured one', () => {
        const [row] = buildProductCandidates([{ externalId: '3', name: 'Napa 500mg' }], [{ id: 'x', name: 'Napa' }], SOURCE);
        expect(row.matchId).toBeNull();
    });

    it('matches measureless products to each other', () => {
        const [row] = buildProductCandidates([{ externalId: '4', name: 'Hand Sanitizer' }], existing, SOURCE);
        expect(row.matchId).toBe('p3');
    });

    it('emits exactly one row per source record', () => {
        const rows = buildProductCandidates(
            [
                { externalId: '1', name: 'Napa 500mg' },
                { externalId: '2', name: 'Napa 250mg' },
            ],
            existing,
            SOURCE,
        );
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.externalId)).toEqual(['1', '2']);
    });

    it('carries the measures through as sourceExtra', () => {
        const [row] = buildProductCandidates([{ externalId: '1', name: 'Napa 500mg 10s' }], existing, SOURCE);
        expect(row.sourceExtra).toBe('10s, 500mg');
    });
});

describe('buildCustomerCandidates', () => {
    const existing: ExistingRecord[] = [
        { id: 'c1', name: 'Rahim Uddin', phone: '+8801712345678' },
        { id: 'c2', name: 'Karim Mia', phone: null },
    ];

    it('auto-accepts an exact phone match regardless of name', () => {
        const [row] = buildCustomerCandidates(
            [{ externalId: '1', name: 'R. Uddin', phone: '01712-345678' }],
            existing,
            SOURCE,
        );
        expect(row.matchId).toBe('c1');
        expect(row.confidence).toBe('high');
        expect(row.decision).toBe('accept');
    });

    it('does not match on name when the phone differs', () => {
        const [row] = buildCustomerCandidates(
            [{ externalId: '2', name: 'Rahim Uddin', phone: '01999999999' }],
            existing,
            SOURCE,
        );
        expect(row.matchId).toBeNull();
        expect(row.decision).toBe('new');
    });

    it('sends a phoneless source customer to review rather than matching on name', () => {
        const [row] = buildCustomerCandidates([{ externalId: '3', name: 'Karim Mia', phone: null }], existing, SOURCE);
        expect(row.confidence).toBe('medium');
        expect(row.decision).toBe('');
    });
});

describe('buildSupplierCandidates', () => {
    const existing: ExistingRecord[] = [{ id: 's1', name: 'Beximco Pharmaceuticals Limited' }];

    it('auto-accepts across corporate suffix and abbreviation drift', () => {
        const [row] = buildSupplierCandidates(
            [{ externalId: '1', name: 'Beximco Pharmaceuticals Ltd' }],
            existing,
            SOURCE,
        );
        expect(row.matchId).toBe('s1');
        expect(row.confidence).toBe('high');
    });

    it('sends a partial name to review', () => {
        const [row] = buildSupplierCandidates([{ externalId: '2', name: 'Beximco Healthcare' }], existing, SOURCE);
        expect(row.confidence).toBe('medium');
        expect(row.decision).toBe('');
    });

    it('proposes nothing for an unrelated supplier', () => {
        const [row] = buildSupplierCandidates([{ externalId: '3', name: 'ACI Limited' }], existing, SOURCE);
        expect(row.matchId).toBeNull();
        expect(row.decision).toBe('new');
    });

    it('offers up to three alternates', () => {
        const many: ExistingRecord[] = [
            { id: 'a', name: 'Beximco Pharma' },
            { id: 'b', name: 'Beximco Healthcare' },
            { id: 'c', name: 'Beximco Agro' },
            { id: 'd', name: 'Beximco Textiles' },
        ];
        const [row] = buildSupplierCandidates([{ externalId: '4', name: 'Beximco' }], many, SOURCE);
        expect(row.altIds.length).toBeLessThanOrEqual(3);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/external-sync/match/candidates`
Expected: FAIL — `Cannot find module './candidates'`

- [ ] **Step 3: Write `match.types.ts`**

```ts
import type { Confidence } from './score';

export type MatchEntity = 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER';

/** What a reviewer may write in the spreadsheet's `decision` column. */
export type MatchDecision = 'accept' | 'new' | 'alt1' | 'alt2' | 'alt3' | 'skip';

export const MATCH_DECISIONS: MatchDecision[] = ['accept', 'new', 'alt1', 'alt2', 'alt3', 'skip'];

/** A record already in the tenant, fetched by the service and passed in. */
export interface ExistingRecord {
    id: string;
    name: string;
    phone?: string | null;
    sku?: string | null;
}

/** A record arriving from the legacy ERP, reduced to what matching needs. */
export interface SourceRecord {
    externalId: string;
    name: string;
    phone?: string | null;
    sku?: string | null;
}

/** One spreadsheet row. */
export interface CandidateRow {
    entity: MatchEntity;
    externalId: string;
    source: string;
    sourceName: string;
    sourceExtra: string;
    suggestedMatch: string | null;
    matchId: string | null;
    confidence: Confidence;
    score: number;
    altCandidates: string[];
    altIds: string[];
    decision: MatchDecision | '';
    notes: string;
}
```

- [ ] **Step 4: Write `candidates.ts`**

```ts
import { normalizeCompanyName, normalizeName, normalizePhone } from './normalize';
import { blockKey, extractMeasureTokens, stripMeasureTokens } from './blocking';
import { confidenceFor, tokenSetSimilarity, type Confidence } from './score';
import type { CandidateRow, ExistingRecord, MatchDecision, MatchEntity, SourceRecord } from './match.types';

const MAX_ALTERNATES = 3;

interface Scored {
    record: ExistingRecord;
    score: number;
}

/** `high` and `low`/`none` arrive pre-filled; `medium` is deliberately blank. */
function decisionFor(confidence: Confidence): MatchDecision | '' {
    if (confidence === 'high') return 'accept';
    if (confidence === 'medium') return '';
    return 'new';
}

function assemble(
    entity: MatchEntity,
    source: string,
    record: SourceRecord,
    sourceExtra: string,
    ranked: Scored[],
    confidenceOverride?: Confidence,
): CandidateRow {
    const best = ranked[0];
    const alternates = ranked.slice(1, 1 + MAX_ALTERNATES);
    const confidence = confidenceOverride ?? confidenceFor(best?.score ?? 0, ranked.length);

    return {
        entity,
        externalId: record.externalId,
        source,
        sourceName: record.name,
        sourceExtra,
        suggestedMatch: best?.record.name ?? null,
        matchId: best?.record.id ?? null,
        confidence,
        score: best ? Number(best.score.toFixed(3)) : 0,
        altCandidates: alternates.map((a) => a.record.name),
        altIds: alternates.map((a) => a.record.id),
        decision: decisionFor(confidence),
        notes: '',
    };
}

function rank(candidates: ExistingRecord[], compare: (record: ExistingRecord) => number): Scored[] {
    return candidates
        .map((record) => ({ record, score: compare(record) }))
        .filter((scored) => scored.score > 0)
        .sort((a, b) => b.score - a.score);
}

/**
 * Products are blocked on their measures first, so only same-strength,
 * same-pack products are ever compared.
 */
export function buildProductCandidates(
    sources: SourceRecord[],
    existing: ExistingRecord[],
    source: string,
): CandidateRow[] {
    const blocks = new Map<string, ExistingRecord[]>();
    for (const record of existing) {
        const key = blockKey(record.name);
        const bucket = blocks.get(key);
        if (bucket) bucket.push(record);
        else blocks.set(key, [record]);
    }

    return sources.map((record) => {
        const key = blockKey(record.name);
        const bucket = blocks.get(key) ?? [];
        const stripped = stripMeasureTokens(record.name);
        const ranked = rank(bucket, (candidate) => tokenSetSimilarity(stripped, stripMeasureTokens(candidate.name)));
        return assemble('PRODUCT', source, record, extractMeasureTokens(record.name).join(', '), ranked);
    });
}

/**
 * Phone is a customer's only real identity. A provider-generated customer code
 * is not identity and is deliberately never matched on — see the spec.
 */
export function buildCustomerCandidates(
    sources: SourceRecord[],
    existing: ExistingRecord[],
    source: string,
): CandidateRow[] {
    const byPhone = new Map<string, ExistingRecord>();
    for (const record of existing) {
        const phone = normalizePhone(record.phone ?? null);
        if (phone && !byPhone.has(phone)) byPhone.set(phone, record);
    }

    return sources.map((record) => {
        const phone = normalizePhone(record.phone ?? null);
        const exact = phone ? byPhone.get(phone) : undefined;

        if (exact) {
            return assemble('CUSTOMER', source, record, phone ?? '', [{ record: exact, score: 1 }], 'high');
        }

        // No phone to identify them by: offer name-similar candidates but never
        // auto-accept — a shared name is not a shared person.
        const normalized = normalizeName(record.name);
        const ranked = rank(existing, (candidate) => tokenSetSimilarity(normalized, normalizeName(candidate.name)));
        const confidence: Confidence = phone ? 'none' : ranked.length > 0 ? 'medium' : 'none';
        return assemble('CUSTOMER', source, record, phone ?? '', phone ? [] : ranked, confidence);
    });
}

/** Suppliers match on the name with corporate suffixes stripped. */
export function buildSupplierCandidates(
    sources: SourceRecord[],
    existing: ExistingRecord[],
    source: string,
): CandidateRow[] {
    return sources.map((record) => {
        const normalized = normalizeCompanyName(record.name);
        const ranked = rank(existing, (candidate) =>
            tokenSetSimilarity(normalized, normalizeCompanyName(candidate.name)),
        );
        return assemble('SUPPLIER', source, record, record.phone ?? '', ranked);
    });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/external-sync/match/candidates`
Expected: PASS — especially "NEVER matches a different strength"

- [ ] **Step 6: Run the whole match suite**

Run: `cd apps/backend && npx jest src/external-sync/match`
Expected: PASS — all four spec files

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/external-sync/match/
git commit -m "feat(external-sync): assemble match candidate rows

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The three adoption fixes

Independent of the workbook, and the reason the import is unsafe today.

**Files:**
- Modify: `apps/backend/src/external-sync/external-sync.service.ts` (product ~619, customer ~713, supplier ~824)
- Test: `apps/backend/src/external-sync/external-sync.adoption.spec.ts` (create)

**Interfaces:**
- Consumes: nothing new
- Produces: no new exports — behavioral change only

- [ ] **Step 1: Read the three adoption sites**

Run: `cd apps/backend && sed -n '615,625p;710,725p;820,830p' src/external-sync/external-sync.service.ts`
Confirm the `findFirst` calls match what the plan describes before editing.

- [ ] **Step 2: Write the failing test**

Create `apps/backend/src/external-sync/external-sync.adoption.spec.ts`. These assert the *query shape* the service builds, which is what the fixes change:

```ts
/**
 * The adoption queries decide which existing record an imported one is welded
 * to, permanently. These tests pin the three properties that make that safe.
 */
describe('adoption query shape', () => {
    it('product adoption is scoped to the tenant and excludes deleted rows', () => {
        const where = productAdoptionWhere('tenant-1', 'SKU-1');
        expect(where).toEqual({ tenant_id: 'tenant-1', sku: 'SKU-1', deleted_at: null });
    });

    it('product adoption never matches on a null sku', () => {
        expect(productAdoptionWhere('tenant-1', null)).toBeNull();
    });

    it('customer adoption matches on phone only, never on customer_code', () => {
        const where = customerAdoptionWhere('tenant-1', '+8801712345678', 'C-101');
        expect(where).toEqual({ tenant_id: 'tenant-1', phone: '+8801712345678', deleted_at: null });
        expect(JSON.stringify(where)).not.toContain('C-101');
    });

    it('customer adoption declines to match when there is no phone', () => {
        expect(customerAdoptionWhere('tenant-1', null, 'C-101')).toBeNull();
    });

    it('supplier adoption excludes soft-deleted tombstones', () => {
        const where = supplierAdoptionWhere('tenant-1', 'Beximco');
        expect(where).toEqual({ tenant_id: 'tenant-1', name: 'Beximco', deleted_at: null });
    });
});
```

Import the three helpers from `./external-sync.service`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/external-sync/external-sync.adoption`
Expected: FAIL — the three helpers are not exported

- [ ] **Step 4: Extract and fix the three query builders**

Add to `external-sync.service.ts`, above the class:

```ts
/**
 * Adoption welds an imported record to an existing one permanently, so each
 * of these returns `null` rather than guessing when it has no safe key.
 */
export function productAdoptionWhere(tenantId: string, sku: string | null) {
    // A null SKU is not an identity — matching on it would adopt an arbitrary
    // untagged product.
    if (!sku) return null;
    return { tenant_id: tenantId, sku, deleted_at: null };
}

export function customerAdoptionWhere(tenantId: string, normalizedPhone: string | null, _customerCode: string) {
    // `customer_code` is generated by `dedupeCode` on the provider's row id, so
    // two unrelated parties can carry the same code. Phone is the only identity
    // a customer actually has.
    if (!normalizedPhone) return null;
    return { tenant_id: tenantId, phone: normalizedPhone, deleted_at: null };
}

export function supplierAdoptionWhere(tenantId: string, name: string) {
    // `deleted_at: null` keeps a provider supplier out of a tombstone it would
    // otherwise be mapped to permanently (TODO.md:357).
    return { tenant_id: tenantId, name, deleted_at: null };
}
```

Then replace the three inline `findFirst` where-clauses with calls to these, skipping adoption entirely when the builder returns `null`. Normalize the phone with `normalizePhone` from `./match/normalize` before calling `customerAdoptionWhere`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/external-sync/external-sync.adoption`
Expected: PASS

- [ ] **Step 6: Run the full external-sync suite for regressions**

Run: `cd apps/backend && npx jest src/external-sync`
Expected: PASS — all pre-existing specs still green

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/external-sync/external-sync.service.ts apps/backend/src/external-sync/external-sync.adoption.spec.ts
git commit -m "fix(external-sync): stop adopting deleted rows and provider codes

Three defects in the adoption queries that decide, permanently, which
existing record an imported one is welded to:

- suppliers could be adopted into a soft-deleted tombstone (TODO.md:357),
  billing every imported purchase to a supplier no picker will show
- customers matched on customer_code, which dedupeCode generates from the
  provider row id, so unrelated parties could collide
- products and customers had no deleted_at scoping either

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Match service and DTOs

**Files:**
- Create: `apps/backend/src/external-sync/external-sync.match.dto.ts`
- Create: `apps/backend/src/external-sync/external-sync.match.service.ts`
- Test: `apps/backend/src/external-sync/external-sync.match.service.spec.ts`
- Modify: `apps/backend/src/external-sync/external-sync.module.ts`

**Interfaces:**
- Consumes: `buildProductCandidates`, `buildCustomerCandidates`, `buildSupplierCandidates`, `CandidateRow`, `MATCH_DECISIONS`
- Produces:
  - `ExternalSyncMatchService.getCandidates(tenantId, provider): Promise<{ manifest: MatchManifest; rows: CandidateRow[] }>`
  - `ExternalSyncMatchService.applyDecisions(tenantId, dto): Promise<{ applied: number; skipped: number }>`
  - `class ApplyMatchDecisionsDto { manifest: MatchManifestDto; rows: MatchDecisionRowDto[] }`
  - `interface MatchManifest { tenantId; connectionId; provider; generatedAt; rowCount }`

- [ ] **Step 1: Write the failing test**

Validation is the dangerous half — a bad file must be rejected whole, never partly applied.

```ts
describe('applyDecisions validation', () => {
    it('rejects the whole file when an external_id is unknown', async () => {
        await expect(service.applyDecisions('t1', fileWith({ externalId: 'nope' })))
            .rejects.toThrow(/unknown external_id/i);
    });

    it('rejects a duplicated external_id', async () => {
        await expect(service.applyDecisions('t1', fileWithDuplicateIds()))
            .rejects.toThrow(/duplicate/i);
    });

    it('rejects an unrecognised decision value', async () => {
        await expect(service.applyDecisions('t1', fileWith({ decision: 'maybe' })))
            .rejects.toThrow(/decision/i);
    });

    it('rejects alt2 when no second alternate was offered', async () => {
        await expect(service.applyDecisions('t1', fileWith({ decision: 'alt2', altIds: ['only-one'] })))
            .rejects.toThrow(/alt2/i);
    });

    it('rejects a manifest whose connection does not match', async () => {
        await expect(service.applyDecisions('t1', fileWithManifest({ connectionId: 'other' })))
            .rejects.toThrow(/manifest/i);
    });

    it('rejects when the row count disagrees with the manifest', async () => {
        await expect(service.applyDecisions('t1', fileWithManifest({ rowCount: 99 })))
            .rejects.toThrow(/row count/i);
    });

    it('writes NOTHING when any row is invalid', async () => {
        await expect(service.applyDecisions('t1', fileWith({ decision: 'maybe' }))).rejects.toThrow();
        expect(db.externalSyncMapping.upsert).not.toHaveBeenCalled();
    });

    it('applies accept as a mapping to the suggested match', async () => {
        await service.applyDecisions('t1', fileWith({ decision: 'accept', matchId: 'p1' }));
        expect(db.externalSyncMapping.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ create: expect.objectContaining({ internal_id: 'p1' }) }),
        );
    });

    it('writes no mapping for new or skip', async () => {
        await service.applyDecisions('t1', fileWith({ decision: 'new' }));
        expect(db.externalSyncMapping.upsert).not.toHaveBeenCalled();
    });
});
```

Mock `db` as a plain object of jest fns; the service takes it via constructor injection like its siblings.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/external-sync/external-sync.match.service`
Expected: FAIL — module not found

- [ ] **Step 3: Write the DTOs**

```ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { MATCH_DECISIONS } from './match/match.types';

/** Sized to a migration workbook, not borrowed from the 5000-row ImportRowsDto. */
export const MAX_DECISION_ROWS = 20000;

export class MatchManifestDto {
    @IsString() connectionId!: string;
    @IsString() provider!: string;
    @IsString() generatedAt!: string;
    @IsInt() rowCount!: number;
}

export class MatchDecisionRowDto {
    @IsString() @MaxLength(64) entity!: string;
    @IsString() @MaxLength(128) externalId!: string;
    @IsIn(MATCH_DECISIONS) decision!: string;
    @IsOptional() @IsString() matchId?: string | null;
    @IsOptional() @IsArray() @IsString({ each: true }) altIds?: string[];
    @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ApplyMatchDecisionsDto {
    @ValidateNested() @Type(() => MatchManifestDto) manifest!: MatchManifestDto;

    @IsArray()
    @ArrayMaxSize(MAX_DECISION_ROWS)
    @ValidateNested({ each: true })
    @Type(() => MatchDecisionRowDto)
    rows!: MatchDecisionRowDto[];
}
```

- [ ] **Step 4: Write the service**

`getCandidates` fetches the connection, pulls existing tenant records (`deleted_at: null`, scoped to `tenant_id`), fetches the provider's records via the same client/mapper the dry run uses, calls the three builders, and returns `{ manifest, rows }`.

`applyDecisions` validates **everything before writing anything**:

```ts
async applyDecisions(tenantId: string, dto: ApplyMatchDecisionsDto) {
    const connection = await this.requireConnection(tenantId, dto.manifest.provider);
    if (connection.id !== dto.manifest.connectionId) {
        throw new BadRequestException('This workbook was generated for a different connection (manifest mismatch).');
    }
    if (dto.rows.length !== dto.manifest.rowCount) {
        throw new BadRequestException(
            `Row count mismatch: the manifest says ${dto.manifest.rowCount} rows but the file has ${dto.rows.length}. Re-download the workbook.`,
        );
    }

    const seen = new Set<string>();
    const writes: { entity: string; externalId: string; internalId: string }[] = [];

    for (const row of dto.rows) {
        const key = `${row.entity}:${row.externalId}`;
        if (seen.has(key)) throw new BadRequestException(`Duplicate external_id ${row.externalId} for ${row.entity}.`);
        seen.add(key);

        // ... resolve accept/alt1-3 to an internal id, verifying it was offered
        // and that the row still exists and is not soft-deleted; `new` and
        // `skip` contribute no write.
    }

    // Only now, with every row validated, persist.
    await this.db.$transaction(writes.map((w) => this.db.externalSyncMapping.upsert({ /* ... */ })));
    return { applied: writes.length, skipped: dto.rows.length - writes.length };
}
```

Register `ExternalSyncMatchService` in `external-sync.module.ts` providers and exports.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/external-sync/external-sync.match.service`
Expected: PASS — including "writes NOTHING when any row is invalid"

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/external-sync/external-sync.match.dto.ts apps/backend/src/external-sync/external-sync.match.service.ts apps/backend/src/external-sync/external-sync.match.service.spec.ts apps/backend/src/external-sync/external-sync.module.ts
git commit -m "feat(external-sync): match candidate service with all-or-nothing decisions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Endpoints

**Files:**
- Modify: `apps/backend/src/external-sync/external-sync.controller.ts`
- Modify: `apps/backend/src/external-sync/tenant-external-sync.controller.ts`
- Test: `apps/backend/src/external-sync/external-sync.match.controller.spec.ts`

**Interfaces:**
- Consumes: `ExternalSyncMatchService`, `ApplyMatchDecisionsDto`
- Produces: `GET …/match-candidates`, `POST …/match-decisions` on both controllers

- [ ] **Step 1: Write the failing test**

```ts
describe('match routes', () => {
    it('admin getCandidates passes the tenantId from the URL', async () => {
        await controller.getMatchCandidates('tenant-1', 'EXPRESS_RETAIL_PRO');
        expect(service.getCandidates).toHaveBeenCalledWith('tenant-1', 'EXPRESS_RETAIL_PRO');
    });

    it('tenant getCandidates uses the interceptor tenant, not a body value', async () => {
        await tenantController.getMatchCandidates({ tenantId: 'tenant-1', userRole: 'OWNER' } as any, undefined);
        expect(service.getCandidates).toHaveBeenCalledWith('tenant-1', undefined);
    });

    it('tenant routes reject a non-owner', async () => {
        await expect(
            tenantController.getMatchCandidates({ tenantId: 'tenant-1', userRole: 'MANAGER' } as any, undefined),
        ).rejects.toThrow(/owner/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/external-sync/external-sync.match.controller`
Expected: FAIL — methods do not exist

- [ ] **Step 3: Add the admin routes**

```ts
@Get('match-candidates')
getMatchCandidates(@Param('tenantId') tenantId: string, @Query('provider') provider?: string) {
    return this.matchService.getCandidates(tenantId, provider);
}

@Post('match-decisions')
applyMatchDecisions(@Param('tenantId') tenantId: string, @Body() dto: ApplyMatchDecisionsDto) {
    return this.matchService.applyDecisions(tenantId, dto);
}
```

Inject `ExternalSyncMatchService` into the constructor.

- [ ] **Step 4: Add the tenant routes**

Same two methods on `TenantExternalSyncController`, reusing the existing owner + `externalImport` feature gate that the other seven routes already apply (see `tenant-external-sync.controller.ts:53-61`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/external-sync/external-sync.match.controller`
Expected: PASS

- [ ] **Step 6: Typecheck and full backend suite**

Run: `cd apps/backend && npx tsc --noEmit && npx jest src/`
Expected: clean typecheck, all tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/external-sync/
git commit -m "feat(external-sync): match-candidate and match-decision endpoints

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Multi-sheet spreadsheet support

**Files:**
- Modify: `apps/frontend/src/lib/spreadsheet.ts:10-33`
- Test: `apps/frontend/src/lib/spreadsheet.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseSpreadsheetFile(file: File, sheetName?: string): Promise<ParsedSpreadsheet>`
  - `listSheetNames(file: File): Promise<string[]>`

> `parseSpreadsheetFile` currently reads `wb.SheetNames[0]` only. A four-sheet
> workbook would silently lose three tabs. The new parameter is optional, so
> all 15 existing `ImportDialog` callers are unaffected.

- [ ] **Step 1: Write the failing test**

```ts
describe('parseSpreadsheetFile with a sheet name', () => {
    it('reads the named sheet rather than the first', async () => {
        const file = workbookWith({ Products: [{ a: '1' }], Suppliers: [{ a: '2' }] });
        const parsed = await parseSpreadsheetFile(file, 'Suppliers');
        expect(parsed.rows).toEqual([{ a: '2' }]);
    });

    it('still reads the first sheet when no name is given', async () => {
        const file = workbookWith({ Products: [{ a: '1' }], Suppliers: [{ a: '2' }] });
        expect((await parseSpreadsheetFile(file)).rows).toEqual([{ a: '1' }]);
    });

    it('throws a helpful error naming the sheets it did find', async () => {
        const file = workbookWith({ Products: [{ a: '1' }] });
        await expect(parseSpreadsheetFile(file, 'Nope')).rejects.toThrow(/Products/);
    });

    it('ignores a sheet name for a CSV', async () => {
        const csv = new File(['a\n1'], 'x.csv');
        expect((await parseSpreadsheetFile(csv, 'Anything')).rows).toEqual([{ a: '1' }]);
    });
});

describe('listSheetNames', () => {
    it('returns the workbook sheet names in order', async () => {
        const file = workbookWith({ Products: [{ a: '1' }], Suppliers: [{ a: '2' }] });
        expect(await listSheetNames(file)).toEqual(['Products', 'Suppliers']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace apps/frontend -- spreadsheet`
Expected: FAIL — the sheet argument is ignored

- [ ] **Step 3: Implement**

```ts
export async function parseSpreadsheetFile(file: File, sheetName?: string): Promise<ParsedSpreadsheet> {
    // ... unchanged extension check and CSV branch (a CSV has one sheet, so
    // `sheetName` is meaningless there and is ignored rather than an error) ...

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const resolved = sheetName ?? wb.SheetNames[0];
    const ws = wb.Sheets[resolved];
    if (!ws) {
        throw new Error(`This file has no sheet named "${resolved}". It contains: ${wb.SheetNames.join(', ')}.`);
    }
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
    return { headers: json.length > 0 ? Object.keys(json[0]) : [], rows: json };
}

export async function listSheetNames(file: File): Promise<string[]> {
    const buffer = await file.arrayBuffer();
    return XLSX.read(buffer, { type: 'array' }).SheetNames;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace apps/frontend -- spreadsheet`
Expected: PASS, including the four pre-existing tests

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/spreadsheet.ts apps/frontend/src/lib/spreadsheet.test.ts
git commit -m "feat(frontend): read a named sheet from a multi-sheet workbook

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Workbook build and parse

**Files:**
- Create: `apps/frontend/src/lib/match-workbook.ts`
- Test: `apps/frontend/src/lib/match-workbook.test.ts`

**Interfaces:**
- Consumes: `parseSpreadsheetFile` from `./spreadsheet`
- Produces:
  - `buildMatchWorkbook(manifest, rows): Promise<void>` — triggers the download
  - `parseMatchWorkbook(file: File): Promise<{ manifest; rows }>`
  - `SHEET_NAMES = ['Manifest', 'Products', 'Customers', 'Suppliers']`

- [ ] **Step 1: Write the failing test**

```ts
describe('match workbook round-trip', () => {
    it('parses back exactly the rows that were written', async () => {
        const rows = [productRow({ externalId: '1' }), customerRow({ externalId: '2' })];
        const parsed = await parseMatchWorkbook(await asFile(buildWorkbookBuffer(manifest, rows)));
        expect(parsed.rows.map((r) => r.externalId)).toEqual(['1', '2']);
    });

    it('preserves the manifest', async () => {
        const parsed = await parseMatchWorkbook(await asFile(buildWorkbookBuffer(manifest, rows)));
        expect(parsed.manifest.connectionId).toBe(manifest.connectionId);
    });

    it('keeps an edited decision and note', async () => {
        const file = await asFile(buildWorkbookBuffer(manifest, [productRow({ externalId: '1', decision: '' })]));
        const edited = await editCell(file, 'Products', 'decision', 'alt1');
        const parsed = await parseMatchWorkbook(edited);
        expect(parsed.rows[0].decision).toBe('alt1');
    });

    it('reads external_id as a string even when Excel makes it numeric', async () => {
        const parsed = await parseMatchWorkbook(await asFile(buildWorkbookBuffer(manifest, [productRow({ externalId: '00123' })])));
        expect(parsed.rows[0].externalId).toBe('00123');
    });

    it('throws when a required sheet is missing', async () => {
        await expect(parseMatchWorkbook(await asFile(workbookMissing('Suppliers')))).rejects.toThrow(/Suppliers/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace apps/frontend -- match-workbook`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
import { parseSpreadsheetFile } from './spreadsheet';
import type { CandidateRow, MatchManifest } from '@/types/match';

export const ENTITY_SHEETS = { PRODUCT: 'Products', CUSTOMER: 'Customers', SUPPLIER: 'Suppliers' } as const;
export const SHEET_NAMES = ['Manifest', 'Products', 'Customers', 'Suppliers'] as const;

/** Column order in every entity sheet. `decision` and `notes` are the editable pair. */
const COLUMNS = [
    'external_id', 'source', 'source_name', 'source_extra',
    'suggested_match', 'match_id', 'confidence', 'alt_candidates', 'alt_ids',
    'decision', 'notes',
] as const;

/** Medium first: the rows that need a human are at the top of each sheet. */
const CONFIDENCE_ORDER: Record<string, number> = { medium: 0, none: 1, low: 2, high: 3 };

function toSheetRow(row: CandidateRow): Record<string, string> {
    return {
        external_id: row.externalId,
        source: row.source,
        source_name: row.sourceName,
        source_extra: row.sourceExtra,
        suggested_match: row.suggestedMatch ?? '',
        match_id: row.matchId ?? '',
        confidence: row.confidence,
        alt_candidates: row.altCandidates.join(' | '),
        alt_ids: row.altIds.join(' | '),
        decision: row.decision,
        notes: row.notes,
    };
}

export async function buildMatchWorkbook(manifest: MatchManifest, rows: CandidateRow[]): Promise<void> {
    // Dynamic import keeps xlsx out of the main bundle, as export-utils.ts:123 does.
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    const manifestRows = Object.entries({ ...manifest, rowCount: rows.length }).map(([key, value]) => ({
        field: key,
        value: String(value),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(manifestRows), 'Manifest');

    for (const [entity, sheet] of Object.entries(ENTITY_SHEETS)) {
        const forEntity = rows
            .filter((r) => r.entity === entity)
            .sort((a, b) => (CONFIDENCE_ORDER[a.confidence] ?? 9) - (CONFIDENCE_ORDER[b.confidence] ?? 9));
        const ws = XLSX.utils.json_to_sheet(forEntity.map(toSheetRow), { header: [...COLUMNS] });

        // Force external_id to text so Excel cannot eat a leading zero.
        for (let i = 0; i < forEntity.length; i++) {
            const cell = ws[XLSX.utils.encode_cell({ c: 0, r: i + 1 })];
            if (cell) { cell.t = 's'; cell.z = '@'; }
        }
        XLSX.utils.book_append_sheet(wb, ws, sheet);
    }

    XLSX.writeFile(wb, `match-review-${manifest.provider}-${manifest.generatedAt.slice(0, 10)}.xlsx`);
}

export async function parseMatchWorkbook(file: File): Promise<{ manifest: MatchManifest; rows: CandidateRow[] }> {
    const manifestSheet = await parseSpreadsheetFile(file, 'Manifest');
    const manifest = Object.fromEntries(
        manifestSheet.rows.map((r) => [String(r.field), String(r.value)]),
    ) as unknown as MatchManifest;

    const rows: CandidateRow[] = [];
    for (const [entity, sheet] of Object.entries(ENTITY_SHEETS)) {
        // Throws naming the sheets it did find when one is missing.
        const parsed = await parseSpreadsheetFile(file, sheet);
        for (const raw of parsed.rows) {
            rows.push({
                entity: entity as CandidateRow['entity'],
                externalId: String(raw.external_id ?? '').trim(),
                source: String(raw.source ?? ''),
                sourceName: String(raw.source_name ?? ''),
                sourceExtra: String(raw.source_extra ?? ''),
                suggestedMatch: String(raw.suggested_match ?? '') || null,
                matchId: String(raw.match_id ?? '') || null,
                confidence: String(raw.confidence ?? 'none') as CandidateRow['confidence'],
                score: 0,
                altCandidates: String(raw.alt_candidates ?? '').split(' | ').filter(Boolean),
                altIds: String(raw.alt_ids ?? '').split(' | ').filter(Boolean),
                decision: String(raw.decision ?? '').trim() as CandidateRow['decision'],
                notes: String(raw.notes ?? ''),
            });
        }
    }
    return { manifest, rows };
}
```

The `CandidateRow` and `MatchManifest` types are shared with the backend — re-declare them in `apps/frontend/src/types/match.ts` matching `match.types.ts` from Task 4 field for field.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace apps/frontend -- match-workbook`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/match-workbook.ts apps/frontend/src/lib/match-workbook.test.ts
git commit -m "feat(frontend): build and parse the match review workbook

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Review controls on the external-import page

**Files:**
- Modify: `apps/frontend/src/app/(app)/settings/data/external-import/page.tsx`
- Modify: `apps/frontend/src/lib/api.ts` (near the tenant external-sync block, ~3315)

**Interfaces:**
- Consumes: `buildMatchWorkbook`, `parseMatchWorkbook`
- Produces:
  - `api.getMatchCandidates(provider?: string)`
  - `api.applyMatchDecisions(payload)`

- [ ] **Step 1: Add the two api.ts calls**

Follow the existing shape in the tenant external-sync block:

```ts
getMatchCandidates: (provider?: string) =>
    fetchWithAuth(`/tenants/external-sync/match-candidates${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),

applyMatchDecisions: (payload: { manifest: unknown; rows: unknown[] }) =>
    fetchWithAuth('/tenants/external-sync/match-decisions', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
    }),
```

- [ ] **Step 2: Add a "Review matches" section to the page**

Two actions, in the existing card layout:
- **Download review workbook** — calls `getMatchCandidates`, then `buildMatchWorkbook`
- **Upload decisions** — file input, `parseMatchWorkbook`, then `applyMatchDecisions`

Per the UI rules: `blue-600` for both primary actions, `text-sm` body, `min-h-touch` on the controls, and results go through the global `Toaster` — no page-local toast. Show `applied` / `skipped` counts on success and the server's message on failure.

- [ ] **Step 3: Verify in the browser**

Run the app and confirm: the section renders inside `PageShell`, no horizontal scroll at 360px, both buttons are ≥44px, a download produces a four-sheet workbook, and a re-upload of an unedited file reports a sane count.

Use the `browser-automation` skill or `run` skill to load the page and check for console errors.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck --workspace apps/frontend && npm run lint --workspace apps/frontend`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(app\)/settings/data/external-import/page.tsx apps/frontend/src/lib/api.ts
git commit -m "feat(frontend): download and upload the match review workbook

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Adoption consults decided mappings

The last wiring step: a live run must honour the decisions rather than re-deciding.

**Files:**
- Modify: `apps/backend/src/external-sync/external-sync.service.ts` (three adoption sites)
- Test: `apps/backend/src/external-sync/external-sync.adoption.spec.ts` (extend)

**Interfaces:**
- Consumes: `productAdoptionWhere`, `customerAdoptionWhere`, `supplierAdoptionWhere` from Task 5
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

```ts
it('uses a decided mapping instead of running adoption', async () => {
    db.externalSyncMapping.findUnique.mockResolvedValue({ internal_id: 'chosen-1' });
    await service.syncProducts(connection, [mappedProduct({ externalId: '1' })]);
    expect(db.product.findFirst).not.toHaveBeenCalled();
});

it('falls back to adoption when no decision was recorded', async () => {
    db.externalSyncMapping.findUnique.mockResolvedValue(null);
    await service.syncProducts(connection, [mappedProduct({ externalId: '1', sku: 'SKU-1' })]);
    expect(db.product.findFirst).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/external-sync/external-sync.adoption`
Expected: FAIL

- [ ] **Step 3: Implement**

The existing mapping lookup already runs first in each of the three sync paths — confirm a decided mapping short-circuits adoption, and that `forgetStaleMapping` does not discard a human decision when the target still exists.

- [ ] **Step 4: Run the full backend suite**

Run: `cd apps/backend && npx tsc --noEmit && npx jest src/`
Expected: clean typecheck, all tests pass

- [ ] **Step 5: Update TODO.md**

Per CLAUDE.md, every task ends with a `TODO.md` update:
- Check off the supplier-tombstone item (TODO.md:357) and move it to `## COMPLETED` with `— done 2026-09-21`
- Add a note under the Dizi section that matching now runs through the review workbook
- Add newly discovered items: threshold tuning after the first real dry run; warehouse attribution still unwritten on document headers

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/external-sync/ TODO.md
git commit -m "feat(external-sync): honour reviewed match decisions on a live run

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification before the first real run

After Task 11, and **before** any non-dry run against Towfiq Traders:

1. `cd apps/backend && npx tsc --noEmit && npx jest src/` — clean
2. `npm run typecheck --workspace apps/frontend && npm run lint --workspace apps/frontend` — clean
3. Confirm each warehouse's `store_id` points at its own branch, so `resolveWarehouseId` lands ExpressRetail stock in Mitford Main Warehouse and Dizi stock in Press Club Main Warehouse:
   ```sql
   SELECT w.name, w.code, w.is_default, s.name AS store
   FROM "Warehouse" w JOIN "Store" s ON s.id = w.store_id
   WHERE w.tenant_id = '<towfiq-tenant-id>';
   ```
4. Dry run **ExpressRetail only**, download the workbook, and read it before anything else. This is where the thresholds get tuned against real names.
5. Only then a live run, one `steps` value at a time: `MASTERS` first, read the warnings, then `PURCHASES`, then `SALES`.

**Import order is load-bearing:** finish and apply ExpressRetail before generating Dizi's workbook, so Dizi's candidates include the records ExpressRetail created.
