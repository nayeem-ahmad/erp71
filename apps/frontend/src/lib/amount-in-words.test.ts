import { takaInWords } from './amount-in-words';

describe('takaInWords', () => {
    it.each([
        [0, 'Taka Zero Only'],
        [7, 'Taka Seven Only'],
        [15, 'Taka Fifteen Only'],
        [40, 'Taka Forty Only'],
        [99, 'Taka Ninety Nine Only'],
        [100, 'Taka One Hundred Only'],
        [1250, 'Taka One Thousand Two Hundred Fifty Only'],
        [20000, 'Taka Twenty Thousand Only'],
    ])('spells %d', (amount, words) => {
        expect(takaInWords(amount)).toBe(words);
    });

    it('counts in lakh and crore, the way a Bangladeshi customer reads a sum', () => {
        expect(takaInWords(150000)).toBe('Taka One Lakh Fifty Thousand Only');
        expect(takaInWords(12345678)).toBe(
            'Taka One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
        );
        expect(takaInWords(1_000_000_000)).toBe('Taka One Hundred Crore Only');
    });

    it('spells the paisa after the taka', () => {
        expect(takaInWords(1250.5)).toBe('Taka One Thousand Two Hundred Fifty and Fifty Paisa Only');
        expect(takaInWords(0.75)).toBe('Taka Zero and Seventy Five Paisa Only');
    });

    it('rounds to the paisa, so floating-point dust never prints', () => {
        expect(takaInWords(0.1 + 0.2)).toBe('Taka Zero and Thirty Paisa Only');
        expect(takaInWords(99.999)).toBe('Taka One Hundred Only');
    });

    it('says minus for a negative amount rather than dropping the sign', () => {
        expect(takaInWords(-500)).toBe('Minus Taka Five Hundred Only');
    });
});
