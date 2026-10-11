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
 * is not identity and is deliberately never matched on — a repeat gets `-2`
 * added and a GUID none at all, so two unrelated parties can carry the same one.
 */
export function buildCustomerCandidates(
    sources: SourceRecord[],
    existing: ExistingRecord[],
    source: string,
): CandidateRow[] {
    const byPhone = new Map<string, ExistingRecord[]>();
    for (const record of existing) {
        const phone = normalizePhone(record.phone ?? null);
        if (!phone) continue;
        const sharing = byPhone.get(phone);
        if (sharing) sharing.push(record);
        else byPhone.set(phone, [record]);
    }

    return sources.map((record) => {
        const phone = normalizePhone(record.phone ?? null);
        const sharing = phone ? byPhone.get(phone) ?? [] : [];

        if (sharing.length === 1) {
            return assemble('CUSTOMER', source, record, phone ?? '', [{ record: sharing[0], score: 1 }], 'high');
        }

        // Two customers on one number — a shop and its branch, or a number
        // passed on — so the phone cannot say which is meant. Offer them all,
        // closest name first, and decide none: taking the first used to link
        // both of a provider's customers to the same one.
        if (sharing.length > 1) {
            const normalized = normalizeName(record.name);
            const ranked = sharing
                .map((candidate) => ({ record: candidate, score: Math.max(tokenSetSimilarity(normalized, normalizeName(candidate.name)), 0.001) }))
                .sort((a, b) => b.score - a.score);
            return assemble('CUSTOMER', source, record, phone ?? '', ranked, 'medium');
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

/**
 * Puts what earlier imports already linked ahead of anything scored.
 *
 * Scoring alone decides every record afresh each time the review runs, so a
 * record an import had linked correctly could be relinked to a namesake — two
 * Express customers sharing a phone were both linked to whichever customer
 * came first, leaving one's documents on a customer it no longer pointed at.
 * So a source record keeps its link (`links`, keyed `ENTITY:externalId`), and
 * no other source record is offered a record that one already holds.
 *
 * `names` names every live record; a link to a record since deleted is
 * dropped and the row keeps its scored suggestion.
 */
export function respectEarlierLinks(
    rows: CandidateRow[],
    links: Map<string, string>,
    names: Map<string, string>,
): CandidateRow[] {
    const held = new Set<string>();
    for (const [key, internalId] of links) {
        if (names.has(internalId)) held.add(`${key.slice(0, key.indexOf(':'))}:${internalId}`);
    }

    return rows.map((row) => {
        const offered = [
            ...(row.matchId ? [{ id: row.matchId, name: row.suggestedMatch ?? '' }] : []),
            ...row.altIds.map((id, i) => ({ id, name: row.altCandidates[i] ?? '' })),
        ];
        const linked = links.get(`${row.entity}:${row.externalId}`);

        if (linked && names.has(linked)) {
            const alternates = offered.filter((o) => o.id !== linked).slice(0, MAX_ALTERNATES);
            return {
                ...row,
                suggestedMatch: names.get(linked)!,
                matchId: linked,
                confidence: 'high',
                score: 1,
                altCandidates: alternates.map((o) => o.name),
                altIds: alternates.map((o) => o.id),
                decision: 'accept',
                notes: 'Linked by an earlier import',
            };
        }

        const free = offered.filter((o) => !held.has(`${row.entity}:${o.id}`));
        if (free.length === offered.length) return row;

        // When the best match belongs to another source record, offer what
        // is left and let a person decide.
        const keptBest = row.matchId !== null && free[0]?.id === row.matchId;
        const [top, ...alternates] = free;
        const confidence: Confidence = keptBest ? row.confidence : top ? 'medium' : 'none';
        return {
            ...row,
            suggestedMatch: top?.name ?? null,
            matchId: top?.id ?? null,
            confidence,
            score: top ? row.score : 0,
            altCandidates: alternates.slice(0, MAX_ALTERNATES).map((o) => o.name),
            altIds: alternates.slice(0, MAX_ALTERNATES).map((o) => o.id),
            decision: decisionFor(confidence),
        };
    });
}
