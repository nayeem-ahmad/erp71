import { classifyPaymentMode } from '../sales/classify-payment-mode';
import { creditDueAmount } from '../customers/customer-credit.utils';

export type SettlementMode = 'cash' | 'bank' | 'bkash' | 'nagad' | 'credit';

const ZERO = 0.005;

export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export function isZeroMoney(value: number): boolean {
    return Math.abs(value) <= ZERO;
}

export interface ExchangeSettlementLeg {
    eventType: 'sale' | 'sale_return';
    mode: SettlementMode;
    amount: number;
    legKey?: 'due' | 'tender';
}

export interface ExchangeSettlement {
    /** Signed. Positive means the customer pays more than the goods coming back. */
    difference: number;
    settlementMode: SettlementMode;
    /** Signed receivable movement. */
    dueDelta: number;
    /** Drawer movement. Non-zero only when the tender is cash. */
    cashDelta: number;
    /** Signed movement through the tender account. Zero when the due absorbs everything. */
    tenderDelta: number;
    legs: ExchangeSettlementLeg[];
}

/**
 * How an exchange settles, given the original invoice.
 *
 * A remaining due absorbs the whole difference. Only the part of a refund
 * that is larger than that due leaves through the original tender. A fully
 * paid invoice uses its first payment. A cleared credit sale, or a remainder
 * whose original tender was itself credit, settles in cash — credit is not an
 * account you can hand money back through once nothing is owed.
 */
export function settleExchange(input: {
    returnedTotal: number;
    replacementTotal: number;
    saleTotal: number;
    amountPaid: number;
    firstPaymentMethod: string | null;
}): ExchangeSettlement {
    const rawDifference = roundMoney(input.replacementTotal - input.returnedTotal);
    const difference = isZeroMoney(rawDifference) ? 0 : rawDifference;
    const balanceDue = creditDueAmount(input.saleTotal, input.amountPaid);
    const hasDue = balanceDue > ZERO;
    const firstMode: SettlementMode | null = input.firstPaymentMethod
        ? classifyPaymentMode(input.firstPaymentMethod)
        : null;

    const paidTender = (mode: SettlementMode | null): SettlementMode =>
        !mode || mode === 'credit' ? 'cash' : mode;

    if (difference === 0) {
        return {
            difference: 0,
            settlementMode: hasDue ? 'credit' : paidTender(firstMode),
            dueDelta: 0,
            cashDelta: 0,
            tenderDelta: 0,
            legs: [],
        };
    }

    if (hasDue && difference > 0) {
        return finish({
            difference,
            settlementMode: 'credit',
            dueDelta: difference,
            tenderMode: 'credit',
        });
    }

    if (hasDue && difference < 0) {
        const refund = -difference;
        if (refund <= balanceDue + ZERO) {
            return finish({
                difference,
                settlementMode: 'credit',
                dueDelta: difference,
                tenderMode: 'credit',
            });
        }
        const dueDelta = roundMoney(-balanceDue);
        return finish({
            difference,
            settlementMode: paidTender(firstMode),
            dueDelta,
            tenderMode: paidTender(firstMode),
        });
    }

    const mode = paidTender(firstMode);
    return finish({
        difference,
        settlementMode: mode,
        dueDelta: 0,
        tenderMode: mode,
    });
}

function finish(input: {
    difference: number;
    settlementMode: SettlementMode;
    dueDelta: number;
    tenderMode: SettlementMode;
}): ExchangeSettlement {
    const tenderDelta = isZeroMoney(input.difference - input.dueDelta)
        ? 0
        : roundMoney(input.difference - input.dueDelta);
    const cashDelta = input.settlementMode === 'cash' ? tenderDelta : 0;
    const legs: ExchangeSettlementLeg[] = [];

    const both = !isZeroMoney(input.dueDelta) && !isZeroMoney(tenderDelta);
    if (both) {
        legs.push({
            eventType: 'sale_return',
            mode: 'credit',
            amount: roundMoney(Math.abs(input.dueDelta)),
            legKey: 'due',
        });
        legs.push({
            eventType: 'sale_return',
            mode: input.tenderMode,
            amount: roundMoney(Math.abs(tenderDelta)),
            legKey: 'tender',
        });
    } else if (!isZeroMoney(input.dueDelta)) {
        legs.push({
            eventType: input.dueDelta > 0 ? 'sale' : 'sale_return',
            mode: 'credit',
            amount: roundMoney(Math.abs(input.dueDelta)),
        });
    } else if (!isZeroMoney(tenderDelta)) {
        legs.push({
            eventType: tenderDelta > 0 ? 'sale' : 'sale_return',
            mode: input.tenderMode,
            amount: roundMoney(Math.abs(tenderDelta)),
        });
    }

    return {
        difference: input.difference,
        settlementMode: input.settlementMode,
        dueDelta: input.dueDelta,
        cashDelta,
        tenderDelta,
        legs,
    };
}

/**
 * The legs a posted exchange actually wrote, rebuilt from the stored deltas.
 *
 * Cancel must void those legs. Re-running settleExchange against the invoice
 * as it stands now would void a different settlement than the one that posted
 * — a later payment, or a due that this exchange itself changed.
 */
export function legsFromStoredSettlement(input: {
    difference: number;
    dueDelta: number;
    settlementMode: SettlementMode;
}): ExchangeSettlementLeg[] {
    const difference = isZeroMoney(input.difference) ? 0 : roundMoney(input.difference);
    const dueDelta = isZeroMoney(input.dueDelta) ? 0 : roundMoney(input.dueDelta);
    return finish({
        difference,
        settlementMode: input.settlementMode,
        dueDelta,
        // A credit settlement has no tender account. The only time a tender
        // leg exists alongside a credit mode is a bug in the stored row, and
        // cash is the account a remainder uses when the original tender was
        // itself credit.
        tenderMode: input.settlementMode === 'credit' ? 'cash' : input.settlementMode,
    }).legs;
}
