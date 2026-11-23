import { round2 } from './money';

export interface EmiRow {
    month: number;
    payment: number;
    interest: number;
    principal: number;
    balance: number;
}

export interface EmiResult {
    emi: number;
    totalInterest: number;
    totalPayment: number;
    schedule: EmiRow[];
}

/**
 * A loan's monthly instalment and schedule. `reducing`: interest on what is
 * still owed, the standard EMI banks quote. `flat`: interest on the whole
 * amount for the whole term — what many NBFIs and dealers quote, and why a
 * "12% flat" loan costs far more than 12% reducing.
 */
export function computeEmi(principal: number, annualRatePct: number, months: number, method: 'reducing' | 'flat'): EmiResult | null {
    const n = Math.floor(months);
    if (!(principal > 0) || !(n > 0) || n > 600 || annualRatePct < 0) return null;
    const schedule: EmiRow[] = [];

    if (method === 'flat') {
        const totalInterest = principal * (annualRatePct / 100) * (n / 12);
        const emi = (principal + totalInterest) / n;
        let balance = principal;
        for (let month = 1; month <= n; month++) {
            const principalPart = principal / n;
            balance -= principalPart;
            schedule.push({ month, payment: round2(emi), interest: round2(totalInterest / n), principal: round2(principalPart), balance: round2(Math.max(0, balance)) });
        }
        return { emi: round2(emi), totalInterest: round2(totalInterest), totalPayment: round2(principal + totalInterest), schedule };
    }

    const r = annualRatePct / 100 / 12;
    const emi = r === 0 ? principal / n : (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1);
    let balance = principal;
    let totalInterest = 0;
    for (let month = 1; month <= n; month++) {
        const interest = balance * r;
        // The last instalment clears what is left, so the schedule ends on zero.
        const principalPart = month === n ? balance : emi - interest;
        balance -= principalPart;
        totalInterest += interest;
        schedule.push({ month, payment: round2(principalPart + interest), interest: round2(interest), principal: round2(principalPart), balance: round2(Math.max(0, balance)) });
    }
    return { emi: round2(emi), totalInterest: round2(totalInterest), totalPayment: round2(principal + totalInterest), schedule };
}
