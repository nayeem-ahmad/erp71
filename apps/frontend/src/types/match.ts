/**
 * Mirrors `apps/backend/src/external-sync/match/match.types.ts`. Kept in step
 * by hand — the two apps share no type package for external-sync.
 */

export type MatchEntity = 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER';

export type MatchDecision = 'accept' | 'new' | 'alt1' | 'alt2' | 'alt3' | 'skip';

export type Confidence = 'high' | 'medium' | 'low' | 'none';

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

export interface MatchManifest {
    tenantId: string;
    connectionId: string;
    provider: string;
    generatedAt: string;
    rowCount: number;
}
