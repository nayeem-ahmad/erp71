import { buildCsv, buildExportMatrix, formatExportValue } from './export-utils';

describe('formatExportValue', () => {
    it('turns nullish values into an empty cell', () => {
        expect(formatExportValue(null)).toBe('');
        expect(formatExportValue(undefined)).toBe('');
    });

    it('stringifies primitives', () => {
        expect(formatExportValue('hello')).toBe('hello');
        expect(formatExportValue(42)).toBe('42');
        expect(formatExportValue(false)).toBe('false');
    });

    it('uses .name when the cell is an object with a name (assignee-style accessors)', () => {
        expect(formatExportValue({ id: 'u1', name: 'Amina' })).toBe('Amina');
    });
});

describe('buildCsv', () => {
    it('joins headers and rows with commas', () => {
        const csv = buildCsv(['Name', 'Amount'], [['Alpha', 100], ['Beta', 200]]);
        expect(csv).toBe('Name,Amount\nAlpha,100\nBeta,200');
    });

    it('quotes cells that contain commas, quotes, or newlines', () => {
        const csv = buildCsv(['Name'], [['A, B'], ['say "hi"'], ['line\nbreak']]);
        expect(csv).toBe('Name\n"A, B"\n"say ""hi"""\n"line\nbreak"');
    });
});

describe('buildExportMatrix', () => {
    const records = [
        { name: 'Alpha', amount: 100, hidden: 'nope' },
        { name: 'Beta', amount: 200, hidden: 'secret' },
    ];

    it('keeps only the chosen columns and uses their labels as headers', () => {
        const matrix = buildExportMatrix(records, [
            { id: 'name', header: 'Name', getValue: (r) => r.name },
            { id: 'amount', header: 'Amount', getValue: (r) => r.amount },
        ]);

        expect(matrix.headers).toEqual(['Name', 'Amount']);
        expect(matrix.rows).toEqual([
            ['Alpha', '100'],
            ['Beta', '200'],
        ]);
    });

    it('omits a column the user did not pick', () => {
        const matrix = buildExportMatrix(records, [
            { id: 'name', header: 'Name', getValue: (r) => r.name },
        ]);

        expect(matrix.headers).toEqual(['Name']);
        expect(matrix.rows).toEqual([['Alpha'], ['Beta']]);
    });
});
