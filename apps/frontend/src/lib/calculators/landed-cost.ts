import { round2 } from './money';

export interface LandedCostInput {
    /** Invoice value in the supplier's currency, CIF (cost, insurance, freight). */
    cifForeign: number;
    exchangeRate: number;
    /** Customs adds a 1% landing charge to the CIF value to reach the assessable value. */
    landingChargePct: number;
    cdPct: number;
    rdPct: number;
    sdPct: number;
    vatPct: number;
    aitPct: number;
    atPct: number;
    /** C&F agent, port, transport and the like, in taka. */
    otherCharges: number;
    quantity: number;
}

export interface LandedCostResult {
    cifBdt: number;
    assessableValue: number;
    cd: number;
    rd: number;
    sd: number;
    vat: number;
    ait: number;
    at: number;
    /** Everything paid at the port: all duties and taxes. */
    totalTaxes: number;
    /** Paid now, claimed back later: VAT, AIT and AT. */
    recoverable: number;
    /** What the goods cost: CIF, landing charge, CD, RD, SD and the other charges. */
    landedCost: number;
    perUnit: number | null;
    /** Taxes as a share of the assessable value — the "TTI" a C&F agent quotes. */
    totalTaxIncidencePct: number;
}

/**
 * The Bangladesh customs sequence: CD and RD on the assessable value, SD on
 * that plus CD and RD, VAT and AT on that plus SD, AIT on the assessable
 * value. VAT, AIT and AT are left out of the goods' cost because a
 * VAT-registered importer gets them back, which is how Imports books them.
 */
export function computeLandedCost(input: LandedCostInput): LandedCostResult {
    const pct = (value: number) => Math.max(0, value) / 100;
    const cifBdt = input.cifForeign * input.exchangeRate;
    const av = cifBdt * (1 + pct(input.landingChargePct));
    const cd = av * pct(input.cdPct);
    const rd = av * pct(input.rdPct);
    const sd = (av + cd + rd) * pct(input.sdPct);
    const vatBase = av + cd + rd + sd;
    const vat = vatBase * pct(input.vatPct);
    const at = vatBase * pct(input.atPct);
    const ait = av * pct(input.aitPct);
    const totalTaxes = cd + rd + sd + vat + ait + at;
    const landedCost = av + cd + rd + sd + Math.max(0, input.otherCharges);
    return {
        cifBdt: round2(cifBdt),
        assessableValue: round2(av),
        cd: round2(cd),
        rd: round2(rd),
        sd: round2(sd),
        vat: round2(vat),
        ait: round2(ait),
        at: round2(at),
        totalTaxes: round2(totalTaxes),
        recoverable: round2(vat + ait + at),
        landedCost: round2(landedCost),
        perUnit: input.quantity > 0 ? round2(landedCost / input.quantity) : null,
        totalTaxIncidencePct: av > 0 ? round2((totalTaxes / av) * 100) : 0,
    };
}
