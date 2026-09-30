import type { CandidateRow, MatchDecision } from '@/types/match';

export function decisionKey(entity: string, externalId: string): string {
    return `${entity}:${externalId}`;
}

export function seedDecisions(rows: CandidateRow[]): Record<string, MatchDecision | ''> {
    const out: Record<string, MatchDecision | ''> = {};
    for (const row of rows) out[decisionKey(row.entity, row.externalId)] = row.decision;
    return out;
}

export function isConfirmReady(
    rows: CandidateRow[],
    decisions: Record<string, MatchDecision | ''>,
): boolean {
    return rows
        .filter((row) => row.confidence === 'medium')
        .every((row) => {
            const value = decisions[decisionKey(row.entity, row.externalId)];
            return (
                value === 'accept' ||
                value === 'new' ||
                value === 'alt1' ||
                value === 'alt2' ||
                value === 'alt3' ||
                value === 'skip'
            );
        });
}

export function assembleDecisionRows(
    rows: CandidateRow[],
    decisions: Record<string, MatchDecision | ''>,
): {
    entity: string;
    externalId: string;
    decision: string;
    matchId?: string | null;
    altIds?: string[];
    notes?: string;
}[] {
    return rows.map((row) => ({
        entity: row.entity,
        externalId: row.externalId,
        decision: decisions[decisionKey(row.entity, row.externalId)] || row.decision,
        matchId: row.matchId,
        altIds: row.altIds,
        notes: row.notes,
    }));
}
