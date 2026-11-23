import { formatBanglaAmount, fromBanglaDigits, integerInBanglaWords, takaInBanglaWords, toBanglaDigits } from './bangla-words';

describe('Bangla amount in words', () => {
    it('reads the irregular numbers below a hundred', () => {
        expect(integerInBanglaWords(25)).toBe('পঁচিশ');
        expect(integerInBanglaWords(99)).toBe('নিরানব্বই');
        expect(integerInBanglaWords(0)).toBe('শূন্য');
    });
    it('counts in শত, হাজার, লক্ষ and কোটি', () => {
        expect(integerInBanglaWords(125300)).toBe('এক লক্ষ পঁচিশ হাজার তিনশত');
        expect(integerInBanglaWords(1_00_00_000)).toBe('এক কোটি');
        expect(integerInBanglaWords(2_50_00_00_000)).toBe('দুইশত পঞ্চাশ কোটি');
    });
    it('writes taka and paisa, closed with মাত্র', () => {
        expect(takaInBanglaWords(125000.5)).toBe('এক লক্ষ পঁচিশ হাজার টাকা পঞ্চাশ পয়সা মাত্র');
        expect(takaInBanglaWords(1000)).toBe('এক হাজার টাকা মাত্র');
    });
    it('converts digits both ways and groups in lakh', () => {
        expect(toBanglaDigits('2026-11-23')).toBe('২০২৬-১১-২৩');
        expect(fromBanglaDigits('১২৫০.৫')).toBe('1250.5');
        expect(formatBanglaAmount(125000.5)).toBe('১,২৫,০০০.৫০');
    });
});
