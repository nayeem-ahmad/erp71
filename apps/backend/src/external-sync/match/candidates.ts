import { blockKey, extractMeasureTokens, stripMeasureTokens } from './blocking';
import { normalizeCompanyName, normalizeName, normalizePhone } from './normalize';
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

function rank(candidates: ExistingRecord[], compare: (record: ExistingRecord) => number): Scored[] {
    return candidates
        .map((record) => ({ record, score: compare(record) }))
        .filter((scored) => scored.score > 0)
        .sort((a, b) => b.score - a.score);
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

/**
 * Products are blocked on their measures first, so only same-strength,
 * same-pack products are ever compared. See `blocking.ts`.
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
        const bucket = blocks.get(blockKey(record.name)) ?? [];
        const stripped = stripMeasureTokens(record.name);
        const ranked = rank(bucket, (candidate) => tokenSetSimilarity(stripped, stripMeasureTokens(candidate.name)));
        return assemble('PRODUCT', source, record, extractMeasureTokens(record.name).join(', '), ranked);
    });
}

/**
 * Phone is a customer's only real identity. A provider-generated customer code
 * is not identity and is deliberately never matched on — `dedupeCode` builds it
 * from the provider's row id, so two unrelated parties can carry the same one.
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

        // A source customer who has a phone that matched nothing is genuinely
        // new; one with no phone at all cannot be identified, so name-similar
        // candidates are offered for review but never auto-accepted — a shared
        // name is not a shared person.
        if (phone) {
            return assemble('CUSTOMER', source, record, phone, [], 'none');
        }

        const normalized = normalizeName(record.name);
        const ranked = rank(existing, (candidate) => tokenSetSimilarity(normalized, normalizeName(candidate.name)));
        return assemble('CUSTOMER', source, record, '', ranked, ranked.length > 0 ? 'medium' : 'none');
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
