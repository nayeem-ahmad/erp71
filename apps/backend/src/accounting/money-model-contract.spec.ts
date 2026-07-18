import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MONEY_MODEL_CONTRACT, MoneyModelEntry } from './money-model-contract';
import { POSTING_CONTRACT } from './posting-contract';

/**
 * The anti-recurrence guard. Parses schema.prisma, finds every model with a
 * `@db.Decimal` field, and asserts each is classified in MONEY_MODEL_CONTRACT.
 * A new money-bearing model fails this until its author classifies it — which is
 * the whole point: the failure modes this project fixed (a model that moves money
 * and never posts) become impossible to add silently.
 */

const SCHEMA_PATH = resolve(__dirname, '../../../../packages/database/prisma/schema.prisma');

function modelsWithMoneyFields(): Set<string> {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    const models = new Set<string>();
    // Match each `model X { ... }` block and keep those with a @db.Decimal field.
    const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(schema)) !== null) {
        const [, name, body] = m;
        if (body.includes('@db.Decimal')) {
            models.add(name);
        }
    }
    return models;
}

const modelOf = (e: MoneyModelEntry) => e.model;
const isPosts = (e: MoneyModelEntry): e is { model: string; postsVia: string; note?: string } => 'postsVia' in e;
const isGap = (e: MoneyModelEntry): e is { model: string; gap: string } => 'gap' in e;
const isExempt = (e: MoneyModelEntry): e is { model: string; exempt: string } => 'exempt' in e;

describe('money-model contract — every money-bearing model is classified', () => {
    const moneyModels = modelsWithMoneyFields();
    const classified = new Set(MONEY_MODEL_CONTRACT.map(modelOf));

    it('finds a non-trivial set of money models in the schema', () => {
        // Guards the parser itself: if the regex silently matched nothing, every
        // other assertion here would pass vacuously.
        expect(moneyModels.size).toBeGreaterThan(30);
    });

    it('classifies every model that has a @db.Decimal field', () => {
        const unclassified = [...moneyModels].filter((model) => !classified.has(model)).sort();
        // A new money model lands here until it is added to MONEY_MODEL_CONTRACT.
        expect(unclassified).toEqual([]);
    });

    it('does not classify a model that no longer has a money field (drift the other way)', () => {
        const stale = [...classified].filter((model) => !moneyModels.has(model)).sort();
        expect(stale).toEqual([]);
    });

    it('has exactly one entry per model — no duplicates', () => {
        const seen = new Map<string, number>();
        for (const e of MONEY_MODEL_CONTRACT) seen.set(e.model, (seen.get(e.model) ?? 0) + 1);
        const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([model]) => model);
        expect(dupes).toEqual([]);
    });
});

describe('money-model contract — classifications are well-formed', () => {
    const validEventTypes = new Set(POSTING_CONTRACT.map((e) => e.eventType));

    it('every postsVia names an event type the posting contract knows', () => {
        const bad = MONEY_MODEL_CONTRACT.filter(isPosts)
            .filter((e) => !validEventTypes.has(e.postsVia as any))
            .map((e) => `${e.model} -> ${e.postsVia}`);
        expect(bad).toEqual([]);
    });

    it('every exempt entry carries a non-empty reason', () => {
        const bad = MONEY_MODEL_CONTRACT.filter(isExempt).filter((e) => !e.exempt.trim()).map(modelOf);
        expect(bad).toEqual([]);
    });

    it('every gap entry carries a non-empty reason', () => {
        const bad = MONEY_MODEL_CONTRACT.filter(isGap).filter((e) => !e.gap.trim()).map(modelOf);
        expect(bad).toEqual([]);
    });
});

describe('money-model contract — known gaps are the ones we expect', () => {
    // Not a silent allowlist: this pins the CURRENT set of unwired money models,
    // so closing one (or introducing one) forces an update here and a conscious
    // look at the list. Update deliberately as gaps are wired.
    it('lists exactly the tracked gaps', () => {
        const gaps = MONEY_MODEL_CONTRACT.filter(isGap).map(modelOf).sort();
        expect(gaps).toEqual(['OrderDeposit']);
    });
});
