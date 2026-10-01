/**
 * A taka amount written out — "Taka One Lakh Fifty Thousand Only" — for the
 * "in words" line printed under an invoice total.
 *
 * Counted in lakh and crore rather than million: that is how the figure is
 * read aloud in Bangladesh, and the words line exists so the sum on paper
 * cannot be misread or quietly altered.
 */

const ONES = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
    if (n < 20) return ONES[n];
    return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(' ');
}

function belowThousand(n: number): string {
    const hundreds = Math.floor(n / 100);
    return [hundreds ? `${ONES[hundreds]} Hundred` : '', belowHundred(n % 100)]
        .filter(Boolean)
        .join(' ');
}

/** Whole number in words; crores recurse, so a hundred crore still reads. */
function integerWords(n: number): string {
    if (n === 0) return 'Zero';

    const crore = Math.floor(n / 10_000_000);
    const lakh = Math.floor((n % 10_000_000) / 100_000);
    const thousand = Math.floor((n % 100_000) / 1000);
    const rest = n % 1000;

    return [
        crore ? `${integerWords(crore)} Crore` : '',
        lakh ? `${belowHundred(lakh)} Lakh` : '',
        thousand ? `${belowHundred(thousand)} Thousand` : '',
        belowThousand(rest),
    ]
        .filter(Boolean)
        .join(' ');
}

export function takaInWords(amount: number): string {
    // Work in whole paisa so 0.1 + 0.2 reads as thirty paisa, not twenty-nine.
    const totalPaisa = Math.round(Math.abs(amount) * 100);
    const taka = Math.floor(totalPaisa / 100);
    const paisa = totalPaisa % 100;

    const words = `Taka ${integerWords(taka)}${paisa ? ` and ${belowHundred(paisa)} Paisa` : ''} Only`;
    return amount < 0 && totalPaisa > 0 ? `Minus ${words}` : words;
}
