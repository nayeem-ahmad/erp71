import {
    buildChequeHtml,
    chequeAmountFigure,
    chequeDateDigits,
    readChequeOffset,
    saveChequeOffset,
    splitChequeWords,
} from './cheque-print';

describe('cheque printing', () => {
    it('writes the figure with lakh grouping and closes it', () => {
        expect(chequeAmountFigure(125000.5)).toBe('1,25,000.50/=');
        expect(chequeAmountFigure(1500)).toBe('1,500.00/=');
    });

    it('puts the date one digit per box, day first', () => {
        expect(chequeDateDigits('2026-12-01')).toEqual(['0', '1', '1', '2', '2', '0', '2', '6']);
        expect(chequeDateDigits('bad')).toEqual([]);
    });

    it('breaks the words at a space', () => {
        const [a, b] = splitChequeWords('Taka One Crore Twenty Five Lakh Thirty Six Thousand Four Hundred Only', 30);
        expect(a.length).toBeLessThanOrEqual(30);
        expect(`${a} ${b}`).toBe('Taka One Crore Twenty Five Lakh Thirty Six Thousand Four Hundred Only');
        expect(splitChequeWords('Taka Ten Only')).toEqual(['Taka Ten Only', '']);
    });

    it('escapes the payee and moves every field by the offset', () => {
        const html = buildChequeHtml(
            { partyName: '<Rahim & Sons>', amount: 1000, chequeDate: '2026-12-01', accountPayee: true, bankName: 'X' },
            { offsetX: 2, offsetY: -1, showGuide: false, acPayeeLabel: 'A/C Payee Only' },
        );
        expect(html).toContain('&lt;Rahim &amp; Sons&gt;');
        expect(html).toContain('left:26mm;top:24mm;'); // payee at 24,25 nudged by +2,-1
        expect(html).toContain('Taka One Thousand Only');
        expect(html).toContain('A/C Payee Only');
        expect(html).toContain('@page { size: 203mm 93mm; margin: 0; }');
    });

    it('leaves the crossing off an open cheque', () => {
        const html = buildChequeHtml(
            { partyName: 'Cash', amount: 10, chequeDate: '2026-12-01', accountPayee: false, bankName: 'X' },
            { offsetX: 0, offsetY: 0, showGuide: false, acPayeeLabel: 'A/C Payee Only' },
        );
        expect(html).not.toContain('A/C Payee Only');
    });

    it('remembers a nudge per bank, ignoring case', () => {
        saveChequeOffset('Sonali Bank', 1.5, -2);
        expect(readChequeOffset('sonali bank ')).toEqual({ offsetX: 1.5, offsetY: -2 });
        expect(readChequeOffset('DBBL')).toEqual({ offsetX: 0, offsetY: 0 });
    });
});
