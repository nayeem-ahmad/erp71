import { AccountType } from './accounting.constants';

/**
 * Cash movements by activity, read straight off the vouchers that touch a cash
 * or bank account (the direct method).
 *
 * The cash-flow report sums the net change of every account outside investing
 * and financing and calls it "operating". That total includes the cash
 * accounts themselves and nets debit-normal against credit-normal balances, so
 * it is not the cash a business generated from operations. This answers that
 * question directly: for every voucher that moved cash, how much cash moved,
 * and what was on the other side of it.
 */

/** Accounts whose movements are investing activity: buying or selling long-lived assets. */
export const INVESTING_ACCOUNT_PATTERN = /(fixed\s+asset|property|equipment|plant|machinery|vehicle|furniture|land|building)/i;
/** Liability accounts whose movements are financing activity: borrowing and repaying. */
export const FINANCING_ACCOUNT_PATTERN = /(loan|borrowing|debt|mortgage|bond)/i;

export type CashActivity = 'operating' | 'investing' | 'financing';

export interface ClassifiableAccount {
    name: string;
    code: string | null;
    type: string;
}

/** Which activity a non-cash account belongs to, using the cash-flow report's own rules. */
export function cashActivityOf(account: ClassifiableAccount): CashActivity {
    const text = `${account.name} ${account.code ?? ''}`;
    if (account.type === AccountType.ASSET && INVESTING_ACCOUNT_PATTERN.test(text)) return 'investing';
    if (account.type === AccountType.EQUITY) return 'financing';
    if (account.type === AccountType.LIABILITY && FINANCING_ACCOUNT_PATTERN.test(text)) return 'financing';
    return 'operating';
}

export interface CashVoucherLine {
    voucherId: string;
    accountId: string;
    debit: number;
    credit: number;
}

export interface CashMovementTotals {
    operating: number;
    investing: number;
    financing: number;
    /** Every activity together: the change in cash and bank over the period. */
    net: number;
}

const round = (value: number) => Math.round(value * 100) / 100 + 0;

/**
 * Sum each voucher's cash movement into the activities on its other side.
 *
 * A voucher's cash movement is the net debit on its cash and bank lines. It is
 * split across the voucher's non-cash lines in proportion to their size, so a
 * receipt that settles both a sale and a loan repayment credits each activity
 * with its own share. A transfer between two cash accounts has no non-cash
 * side and moves no cash overall, so it counts nowhere.
 *
 * `activityOf` returns null for a line that is itself cash or bank.
 */
export function apportionCashMovements(
    lines: readonly CashVoucherLine[],
    activityOf: (accountId: string) => CashActivity | null,
): CashMovementTotals {
    const byVoucher = new Map<string, CashVoucherLine[]>();
    for (const line of lines) {
        const list = byVoucher.get(line.voucherId) ?? [];
        list.push(line);
        byVoucher.set(line.voucherId, list);
    }

    const totals = { operating: 0, investing: 0, financing: 0 };
    for (const voucherLines of byVoucher.values()) {
        let cashDelta = 0;
        const counterparts: Array<{ activity: CashActivity; weight: number }> = [];
        for (const line of voucherLines) {
            const activity = activityOf(line.accountId);
            if (activity === null) {
                cashDelta += line.debit - line.credit;
            } else {
                const weight = Math.abs(line.debit - line.credit);
                if (weight > 0) counterparts.push({ activity, weight });
            }
        }
        if (cashDelta === 0 || counterparts.length === 0) continue;

        const totalWeight = counterparts.reduce((sum, c) => sum + c.weight, 0);
        for (const { activity, weight } of counterparts) {
            totals[activity] += cashDelta * (weight / totalWeight);
        }
    }

    const operating = round(totals.operating);
    const investing = round(totals.investing);
    const financing = round(totals.financing);
    return { operating, investing, financing, net: round(operating + investing + financing) };
}
