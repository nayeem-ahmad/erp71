import { round2 } from './money';

/** Grams in one ভরি (tola), the unit gold and silver are priced in here. */
export const GRAMS_PER_VORI = 11.664;
/** Nisab: 85 g of gold, or 595 g of silver. */
export const NISAB_GOLD_GRAMS = 85;
export const NISAB_SILVER_GRAMS = 595;
export const ZAKAT_RATE = 0.025;

export interface ZakatInput {
    cash: number;
    bank: number;
    /** Stock valued at what it would sell for today. */
    stock: number;
    /** Money customers owe that is expected to be paid. */
    receivables: number;
    goldValue: number;
    silverValue: number;
    otherAssets: number;
    /** Debts due now: supplier dues, loan instalments, bills. */
    liabilities: number;
    /** Price of one ভরি, for the nisab. */
    goldPricePerVori: number;
    silverPricePerVori: number;
    nisabBasis: 'gold' | 'silver';
}

export interface ZakatResult {
    totalAssets: number;
    netWealth: number;
    nisab: number;
    due: boolean;
    zakat: number;
}

/**
 * 2.5% of zakatable wealth held for a lunar year, once it reaches the nisab.
 * The arithmetic only: what counts as zakatable, and which nisab applies, is
 * for the owner and their scholar.
 */
export function computeZakat(input: ZakatInput): ZakatResult {
    const positive = (value: number) => Math.max(0, value);
    const totalAssets =
        positive(input.cash) + positive(input.bank) + positive(input.stock) + positive(input.receivables) +
        positive(input.goldValue) + positive(input.silverValue) + positive(input.otherAssets);
    const netWealth = totalAssets - positive(input.liabilities);
    const nisab =
        input.nisabBasis === 'gold'
            ? (NISAB_GOLD_GRAMS / GRAMS_PER_VORI) * positive(input.goldPricePerVori)
            : (NISAB_SILVER_GRAMS / GRAMS_PER_VORI) * positive(input.silverPricePerVori);
    const due = nisab > 0 && netWealth >= nisab;
    return {
        totalAssets: round2(totalAssets),
        netWealth: round2(netWealth),
        nisab: round2(nisab),
        due,
        zakat: due ? round2(netWealth * ZAKAT_RATE) : 0,
    };
}
