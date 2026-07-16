/**
 * Decides whether a voucher was fabricated by the condition_key:'none' posting
 * fallback, as opposed to being something the tenant deliberately configured.
 *
 * Kept free of Prisma and side effects so it can be tested in isolation: this
 * function decides what gets deleted from real financial records.
 */

/** source_type -> the event type autoPostFromRules used, for the posting event key. */
export const FABRICATED_SOURCE_TYPES: Record<string, 'fund_movement' | 'inventory_adjustment'> = {
    transfer: 'fund_movement',
    shrinkage: 'inventory_adjustment',
    stock_take_adjustment: 'inventory_adjustment',
};

/** The exact account pair each harmful fallback rule produced. */
export const FALLBACK_FINGERPRINTS: Record<string, { debit: string; credit: string }> = {
    fund_movement: { debit: 'Main Bank Account', credit: 'Cash in Hand' },
    inventory_adjustment: { debit: 'General Operating Expense', credit: 'Cash in Hand' },
};

export interface FabricationCandidate {
    source_type: string | null;
    details: Array<{
        account_id: string;
        debit_amount: unknown;
        credit_amount: unknown;
    }>;
}

/**
 * True only when the voucher's source_type matches a fallback-prone event AND its
 * two lines are exactly that fallback's account pair.
 *
 * PostingRule is tenant-configurable: a tenant may have deliberately configured
 * correct transfer postings. Matching on source_type alone would destroy them.
 */
export function isFabricatedVoucher(
    voucher: FabricationCandidate,
    accountNameById: Map<string, string>,
): boolean {
    if (!voucher.source_type) {
        return false;
    }

    const eventType = FABRICATED_SOURCE_TYPES[voucher.source_type];
    if (!eventType) {
        return false;
    }

    const fingerprint = FALLBACK_FINGERPRINTS[eventType];
    if (voucher.details.length !== 2) {
        return false;
    }

    const debitLine = voucher.details.find((line) => Number(line.debit_amount) > 0);
    const creditLine = voucher.details.find((line) => Number(line.credit_amount) > 0);

    if (!debitLine || !creditLine) {
        return false;
    }

    return (
        accountNameById.get(debitLine.account_id) === fingerprint.debit &&
        accountNameById.get(creditLine.account_id) === fingerprint.credit
    );
}
