import { Prisma, PrismaClient, PartyType } from '@prisma/client';

type Client = PrismaClient | Prisma.TransactionClient;

export interface PartyLedgerParams {
    from?: string;
    to?: string;
    /** Row type labels the frontend keys on for increase vs decrease rendering. */
    increaseLabel: string;
    decreaseLabel: string;
}

export interface PartyLedgerRow {
    id: string;
    type: string;
    amount: number;
    balance_before: number;
    balance_after: number;
    notes: string | null;
    payment_number: string | null;
    created_at: Date;
}

export interface PartyLedger {
    opening_balance: number;
    closing_balance: number;
    transactions: PartyLedgerRow[];
    total: number;
}

/**
 * Builds a party's subsidiary ledger straight from the GL: the voucher lines
 * tagged to that party on its control account, in the account's natural sign
 * (receivable = debit − credit, payable = credit − debit). This is the
 * GL-derived view that replaces reading CustomerCreditTransaction /
 * SupplierCreditTransaction directly — the ledger now reflects what was actually
 * posted, and its balance equals the control account's per-party balance by
 * construction.
 */
export async function buildPartyLedger(
    db: Client,
    tenantId: string,
    partyType: PartyType,
    partyId: string,
    params: PartyLedgerParams,
): Promise<PartyLedger> {
    const control = await db.account.findFirst({
        where: { tenant_id: tenantId, party_type: partyType },
        select: { id: true },
    });
    if (!control) {
        return { opening_balance: 0, closing_balance: 0, transactions: [], total: 0 };
    }

    const isAsset = partyType === 'CUSTOMER';
    const lines = await db.voucherDetail.findMany({
        where: { account_id: control.id, party_id: partyId },
        include: { voucher: { select: { date: true, voucher_number: true, description: true } } },
        orderBy: [{ voucher: { date: 'asc' } }, { created_at: 'asc' }],
    });

    const naturalDelta = (line: (typeof lines)[number]) => {
        const debit = Number(line.debit_amount);
        const credit = Number(line.credit_amount);
        return isAsset ? debit - credit : credit - debit;
    };

    const from = params.from ? startOfDay(params.from) : null;
    const to = params.to ? endOfDay(params.to) : null;

    let running = 0;
    let opening = 0;
    const transactions: PartyLedgerRow[] = [];

    for (const line of lines) {
        const delta = naturalDelta(line);
        const date = line.voucher.date;

        if (from && date < from) { running += delta; opening = running; continue; }
        if (to && date > to) continue;

        const balance_before = running;
        running += delta;
        transactions.push({
            id: line.id,
            type: delta >= 0 ? params.increaseLabel : params.decreaseLabel,
            amount: Math.abs(delta),
            balance_before,
            balance_after: running,
            notes: line.voucher.description ?? null,
            payment_number: line.voucher.voucher_number ?? null,
            created_at: date,
        });
    }

    return {
        opening_balance: opening,
        closing_balance: transactions.length > 0 ? transactions[transactions.length - 1].balance_after : opening,
        transactions,
        total: transactions.length,
    };
}

function startOfDay(iso: string): Date {
    const d = new Date(iso);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function endOfDay(iso: string): Date {
    const d = new Date(iso);
    d.setUTCHours(23, 59, 59, 999);
    return d;
}
