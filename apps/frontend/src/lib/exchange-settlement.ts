import { hasPermission, isOwner } from '@/lib/permissions';

/**
 * Mirrors `apps/backend/src/sales-exchanges/exchange-settlement.ts`.
 * The screen only previews; the server is what settles.
 */
export type SettlementMode = 'cash' | 'bank' | 'bkash' | 'nagad' | 'credit';

const ZERO = 0.005;

export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export function isZeroMoney(value: number): boolean {
    return Math.abs(value) <= ZERO;
}

export function classifyPaymentMode(method: string): SettlementMode {
    const normalized = method.toLowerCase();
    if (normalized.includes('bkash')) return 'bkash';
    if (normalized.includes('nagad')) return 'nagad';
    if (normalized.includes('credit')) return 'credit';
    if (
        normalized.includes('bank')
        || normalized.includes('card')
        || normalized.includes('wallet')
        || normalized.includes('transfer')
    ) {
        return 'bank';
    }
    return 'cash';
}

export interface ExchangeSettlementPreview {
    difference: number;
    settlementMode: SettlementMode;
    dueDelta: number;
    cashDelta: number;
    tenderDelta: number;
}

export function previewExchangeSettlement(input: {
    returnedTotal: number;
    replacementTotal: number;
    saleTotal: number;
    amountPaid: number;
    firstPaymentMethod: string | null;
}): ExchangeSettlementPreview {
    const rawDifference = roundMoney(input.replacementTotal - input.returnedTotal);
    const difference = isZeroMoney(rawDifference) ? 0 : rawDifference;
    const balanceDue = Math.max(0, input.saleTotal - input.amountPaid);
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
        };
    }

    if (hasDue && difference > 0) {
        return finish({ difference, settlementMode: 'credit', dueDelta: difference });
    }

    if (hasDue && difference < 0) {
        const refund = -difference;
        if (refund <= balanceDue + ZERO) {
            return finish({ difference, settlementMode: 'credit', dueDelta: difference });
        }
        return finish({
            difference,
            settlementMode: paidTender(firstMode),
            dueDelta: roundMoney(-balanceDue),
        });
    }

    return finish({
        difference,
        settlementMode: paidTender(firstMode),
        dueDelta: 0,
    });
}

function finish(input: {
    difference: number;
    settlementMode: SettlementMode;
    dueDelta: number;
}): ExchangeSettlementPreview {
    const tenderDelta = isZeroMoney(input.difference - input.dueDelta)
        ? 0
        : roundMoney(input.difference - input.dueDelta);
    return {
        difference: input.difference,
        settlementMode: input.settlementMode,
        dueDelta: input.dueDelta,
        cashDelta: input.settlementMode === 'cash' ? tenderDelta : 0,
        tenderDelta,
    };
}

/** Tender movement implied by a posted row. Do not re-settle against the live sale. */
export function storedTenderDelta(difference: number, dueDelta: number): number {
    const diff = isZeroMoney(difference) ? 0 : roundMoney(difference);
    const due = isZeroMoney(dueDelta) ? 0 : roundMoney(dueDelta);
    return isZeroMoney(diff - due) ? 0 : roundMoney(diff - due);
}

export interface ExchangeSettlementCopy {
    even: string;
    pay: string;
    refund: string;
    dueUp: string;
    dueDown: string;
    dueAndRefund: string;
    tender: Partial<Record<SettlementMode, string>>;
}

export function exchangeSettlementSentence(
    input: {
        difference: number;
        dueDelta: number;
        tenderDelta: number;
        settlementMode: string;
    },
    copy: ExchangeSettlementCopy,
    formatAmount: (amount: number) => string,
    format: (template: string, values: Record<string, string | number>) => string,
): string {
    const tender = copy.tender[input.settlementMode as SettlementMode] ?? input.settlementMode;
    if (isZeroMoney(input.difference)) return copy.even;

    const due = input.dueDelta;
    const tenderDelta = input.tenderDelta;
    if (due > ZERO && isZeroMoney(tenderDelta)) {
        return format(copy.dueUp, { amount: formatAmount(due) });
    }
    if (due < -ZERO && tenderDelta < -ZERO) {
        return format(copy.dueAndRefund, {
            due: formatAmount(Math.abs(due)),
            amount: formatAmount(Math.abs(tenderDelta)),
            tender,
        });
    }
    if (due < -ZERO && isZeroMoney(tenderDelta)) {
        return format(copy.dueDown, { amount: formatAmount(Math.abs(due)) });
    }
    if (tenderDelta > ZERO) {
        return format(copy.pay, { amount: formatAmount(tenderDelta), tender });
    }
    if (tenderDelta < -ZERO) {
        return format(copy.refund, { amount: formatAmount(Math.abs(tenderDelta)), tender });
    }
    return copy.even;
}

/** Hidden without CANCEL_ENTRY, and always hidden once the exchange is cancelled. OWNER bypasses the grant. */
export function canCancelExchange(
    role: string | null | undefined,
    permissions: string[] | undefined,
    status: string | null | undefined,
): boolean {
    if (status === 'CANCELLED') return false;
    return isOwner(role) || hasPermission(permissions, 'CANCEL_ENTRY');
}
