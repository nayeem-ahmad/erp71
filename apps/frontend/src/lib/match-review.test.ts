import {
    seedDecisions,
    isConfirmReady,
    assembleDecisionRows,
    decisionKey,
    applyBulkDecision,
} from './match-review';
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

describe('applyBulkDecision', () => {
    it('sets create-as-new on every targeted row', () => {
        const rows = [row(), row({ externalId: '2', matchId: null, suggestedMatch: null })];
        const decisions = seedDecisions(rows);
        const result = applyBulkDecision(rows, decisions, 'new');
        expect(result.applied).toBe(2);
        expect(result.skipped).toBe(0);
        expect(result.next[decisionKey('PRODUCT', '1')]).toBe('new');
        expect(result.next[decisionKey('PRODUCT', '2')]).toBe('new');
    });

    it('accepts only rows that have a suggested match', () => {
        const rows = [
            row(),
            row({ externalId: '2', matchId: null, suggestedMatch: null, decision: '' }),
        ];
        const decisions = seedDecisions(rows);
        const result = applyBulkDecision(rows, decisions, 'accept');
        expect(result.applied).toBe(1);
        expect(result.skipped).toBe(1);
        expect(result.next[decisionKey('PRODUCT', '1')]).toBe('accept');
        expect(result.next[decisionKey('PRODUCT', '2')]).toBe('');
    });

    it('marks every targeted row as skip', () => {
        const rows = [row(), row({ externalId: '2' })];
        const decisions = seedDecisions(rows);
        const result = applyBulkDecision(rows, decisions, 'skip');
        expect(result.applied).toBe(2);
        expect(result.next[decisionKey('PRODUCT', '1')]).toBe('skip');
        expect(result.next[decisionKey('PRODUCT', '2')]).toBe('skip');
    });

    it('leaves rows that were not targeted unchanged', () => {
        const kept = row({ externalId: 'keep', decision: 'accept', confidence: 'high' });
        const target = row({ externalId: 'change', decision: '' });
        const decisions = seedDecisions([kept, target]);
        const result = applyBulkDecision([target], decisions, 'new');
        expect(result.next[decisionKey('PRODUCT', 'keep')]).toBe('accept');
        expect(result.next[decisionKey('PRODUCT', 'change')]).toBe('new');
        expect(result.applied).toBe(1);
    });
});
