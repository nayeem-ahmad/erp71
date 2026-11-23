/**
 * A taka amount in Bangla words — "এক লক্ষ পঁচিশ হাজার টাকা মাত্র" — for
 * invoices, cheques and deeds written in Bangla.
 *
 * Bangla has an irregular word for every number from 0 to 99 (there is no
 * "twenty-five" built from "twenty" and "five": it is পঁচিশ), so they are a
 * table rather than a rule. Above that it counts in শত, হাজার, লক্ষ and কোটি,
 * like the English version in `amount-in-words.ts`.
 */

const BELOW_HUNDRED = [
    'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
    'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ',
    'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
    'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
    'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
    'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
    'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
    'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
    'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
    'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
] as const;

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

function belowThousand(n: number): string {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return [hundreds ? `${BELOW_HUNDRED[hundreds]}শত` : '', rest ? BELOW_HUNDRED[rest] : ''].filter(Boolean).join(' ');
}

/** A whole number in Bangla words. Crores recurse, so a hundred crore still reads. */
export function integerInBanglaWords(n: number): string {
    const whole = Math.floor(Math.abs(n));
    if (whole === 0) return BELOW_HUNDRED[0];
    const crore = Math.floor(whole / 10_000_000);
    const lakh = Math.floor((whole % 10_000_000) / 100_000);
    const thousand = Math.floor((whole % 100_000) / 1000);
    const rest = whole % 1000;
    return [
        crore ? `${integerInBanglaWords(crore)} কোটি` : '',
        lakh ? `${BELOW_HUNDRED[lakh]} লক্ষ` : '',
        thousand ? `${BELOW_HUNDRED[thousand]} হাজার` : '',
        rest ? belowThousand(rest) : '',
    ]
        .filter(Boolean)
        .join(' ');
}

/** "এক লক্ষ পঁচিশ হাজার টাকা পঞ্চাশ পয়সা মাত্র". */
export function takaInBanglaWords(amount: number): string {
    const totalPaisa = Math.round(Math.abs(amount) * 100);
    const taka = Math.floor(totalPaisa / 100);
    const paisa = totalPaisa % 100;
    const words = `${integerInBanglaWords(taka)} টাকা${paisa ? ` ${BELOW_HUNDRED[paisa]} পয়সা` : ''} মাত্র`;
    return amount < 0 && totalPaisa > 0 ? `ঋণাত্মক ${words}` : words;
}

/** Western digits as Bangla digits; everything else untouched. */
export function toBanglaDigits(value: string): string {
    return value.replace(/[0-9]/g, (digit) => BANGLA_DIGITS[Number(digit)]);
}

/** Bangla digits back to Western ones, so a pasted "১২৫০" can be read as a number. */
export function fromBanglaDigits(value: string): string {
    return value.replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)));
}

/** ১,২৫,০০০.৫০ — lakh grouping, two decimals, in Bangla digits. */
export function formatBanglaAmount(amount: number): string {
    const grouped = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    return toBanglaDigits(grouped);
}
