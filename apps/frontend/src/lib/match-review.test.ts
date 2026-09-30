import { seedDecisions, isConfirmReady, assembleDecisionRows, decisionKey } from './match-review';
import type { CandidateRow } from '@/types/match';

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
    return {
        entity: 'PRODUCT',
        externalId: '1',
        source: 'Dizi',
        sourceName: 'Napa 500mg',
        sourceExtra: '500mg',
        suggestedMatch: 'Napa 500 mg',
        matchId: 'p1',
        confidence: 'medium',
        score: 0.6,
        altCandidates: ['Other'],
        altIds: ['p2'],
        decision: '',
        notes: '',
        ...overrides,
    };
}

describe('isConfirmReady', () => {
    it('is false while a medium row is blank', () => {
        const rows = [row(), row({ externalId: '2', confidence: 'high', decision: 'accept' })];
        const decisions = seedDecisions(rows);
        expect(isConfirmReady(rows, decisions)).toBe(false);
        decisions[decisionKey('PRODUCT', '1')] = 'alt1';
        expect(isConfirmReady(rows, decisions)).toBe(true);
    });
});

describe('assembleDecisionRows', () => {
    it('emits every row, including auto-matched high ones', () => {
        const rows = [
            row({ confidence: 'high', decision: 'accept', externalId: 'h' }),
            row({ confidence: 'medium', decision: '', externalId: 'm' }),
        ];
        const decisions = seedDecisions(rows);
        decisions[decisionKey('PRODUCT', 'm')] = 'new';
        const body = assembleDecisionRows(rows, decisions);
        expect(body).toHaveLength(2);
        expect(body.find((r) => r.externalId === 'h')?.decision).toBe('accept');
        expect(body.find((r) => r.externalId === 'm')?.decision).toBe('new');
    });
});
