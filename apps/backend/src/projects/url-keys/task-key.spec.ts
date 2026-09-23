import { composeTaskKey, parseTaskKey } from './task-key';

describe('composeTaskKey', () => {
    it('joins the project code and the reference', () => {
        expect(composeTaskKey('ERP', 14)).toBe('ERP-14');
    });

    it('keeps a hyphenated code intact', () => {
        expect(composeTaskKey('D1-BR3', 7)).toBe('D1-BR3-7');
    });
});

describe('parseTaskKey', () => {
    it('splits on the LAST hyphen, not the first', () => {
        // The bug a naive split introduces: D1 + "BR3-7".
        expect(parseTaskKey('D1-BR3-7')).toEqual({ code: 'D1-BR3', reference: 7 });
    });

    it('handles a code that itself ends in digits', () => {
        // 737 of production's 842 tasks live in PRJ-0002.
        expect(parseTaskKey('PRJ-0002-14')).toEqual({ code: 'PRJ-0002', reference: 14 });
    });

    it('parses a simple code', () => {
        expect(parseTaskKey('ERP-14')).toEqual({ code: 'ERP', reference: 14 });
    });

    it('rejects a key with no reference', () => {
        expect(parseTaskKey('ERP')).toBeNull();
    });

    it('rejects a non-numeric tail', () => {
        expect(parseTaskKey('ERP-abc')).toBeNull();
    });

    it('rejects a zero or negative reference', () => {
        expect(parseTaskKey('ERP-0')).toBeNull();
        expect(parseTaskKey('ERP--1')).toBeNull();
    });

    it('rejects an empty code', () => {
        expect(parseTaskKey('-14')).toBeNull();
    });

    it('round-trips every real production code', () => {
        for (const code of ['PRJ-0002', 'PRJ-0004', 'D1-BR3', 'D1-DIGI', 'D2-BR3', 'ERP']) {
            expect(parseTaskKey(composeTaskKey(code, 14))).toEqual({ code, reference: 14 });
        }
    });
});
