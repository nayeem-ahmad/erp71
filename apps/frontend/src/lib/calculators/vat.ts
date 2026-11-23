import { round2 } from './money';

/** The standard VAT rates under the VAT and SD Act 2012, most common first. */
export const VAT_RATES = [15, 10, 7.5, 5] as const;

export interface VatResult {
    /** The value of the supply, before SD and VAT. */
    net: number;
    sd: number;
    vat: number;
    /** What the customer pays. */
    gross: number;
}

/**
 * VAT and supplementary duty either way round. SD is levied on the value of
 * the supply, VAT on the value plus the SD — the same order `vat-pricing.ts`
 * uses for sales, so this agrees with what a posted invoice shows.
 */
export function computeVat(amount: number, vatRate: number, sdRate: number, mode: 'exclusive' | 'inclusive'): VatResult {
    const vatFactor = 1 + Math.max(0, vatRate) / 100;
    const sdFactor = 1 + Math.max(0, sdRate) / 100;
    const net = mode === 'exclusive' ? amount : amount / (sdFactor * vatFactor);
    const sd = net * (sdFactor - 1);
    const vat = (net + sd) * (vatFactor - 1);
    const gross = mode === 'exclusive' ? net + sd + vat : amount;
    return { net: round2(net), sd: round2(sd), vat: round2(vat), gross: round2(gross) };
}
