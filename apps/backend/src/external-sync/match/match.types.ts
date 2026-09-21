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

/** Identifies the run a workbook was generated from, so a stale file is caught. */
export interface MatchManifest {
    tenantId: string;
    connectionId: string;
    provider: string;
    generatedAt: string;
    rowCount: number;
}
