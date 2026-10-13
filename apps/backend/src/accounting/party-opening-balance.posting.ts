import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AutoPostResult, MultiLegLeg, postMultiLeg } from './posting.utils';

/**
 * The equity account an opening due is posted against. Seeded by
 * `DEFAULT_ACCOUNTING_TEMPLATE` (310102) and carried to existing tenants by
 * `sync:accounting`, which runs on every container start.
 */
export const OPENING_BALANCE_EQUITY_ACCOUNT = 'Opening Balance Equity';

export interface PartyOpeningBalanceInput {
    tx: Prisma.TransactionClient;
    tenantId: string;
    party: 'CUSTOMER' | 'SUPPLIER';
    partyId: string;
    /**
     * As the party's ledger carries it: positive is what the customer owed the
     * shop, or what the shop owed the supplier; negative is an advance.
     */
    amount: number;
    date: Date;
    sourceModule: string;
    /** The party ledger row the opening was written as — one voucher per row. */
    sourceId: string;
    storeId?: string;
    description: string;
}

/**
 * Puts a party's opening due into the books, so the control account carries
 * it on the party's own subsidiary ledger.
 *
 * Without this the ledger row moves `due_balance` and the books never hear of
 * it: the customer ledger, which is read from the GL, closes lower than the
 * previous due the sale screen shows by exactly the opening. Posted against
 * Opening Balance Equity rather than revenue or purchases, because it is a
 * position brought over from before the books started, not a sale or a
 * purchase of ours.
 *
 * A workspace with no control account for the party has no books to post to,
 * so nothing is posted, as with a sale on a tenant whose posting rules are
 * missing. One with the control account but no equity account is refused: a
 * single leg would unbalance the books, and skipping would bring the mismatch
 * back silently.
 */
export async function postPartyOpeningBalance(input: PartyOpeningBalanceInput): Promise<AutoPostResult> {
    const amount = Math.round(Math.abs(input.amount) * 100) / 100;
    if (amount === 0) return { postingStatus: 'skipped' };

    const control = await input.tx.account.findFirst({
        where: { tenant_id: input.tenantId, party_type: input.party },
        select: { id: true },
    });
    if (!control) return { postingStatus: 'skipped' };

    const equity = await input.tx.account.findFirst({
        where: { tenant_id: input.tenantId, name: OPENING_BALANCE_EQUITY_ACCOUNT },
        select: { id: true },
    });
    if (!equity) {
        throw new BadRequestException(
            `Account "${OPENING_BALANCE_EQUITY_ACCOUNT}" is not set up for this workspace. Run sync:accounting to add it.`,
        );
    }

    // Receivable is an asset and grows on the debit side; payable is a
    // liability and grows on the credit side. An advance runs the other way.
    const isCustomer = input.party === 'CUSTOMER';
    const controlOnDebit = (input.amount > 0) === isCustomer;
    const legs: MultiLegLeg[] = controlOnDebit
        ? [
            { accountId: control.id, debit: amount, partyType: input.party, partyId: input.partyId },
            { accountId: equity.id, credit: amount },
        ]
        : [
            { accountId: control.id, credit: amount, partyType: input.party, partyId: input.partyId },
            { accountId: equity.id, debit: amount },
        ];

    return postMultiLeg({
        tx: input.tx,
        tenantId: input.tenantId,
        eventType: 'party_opening_balance',
        sourceModule: input.sourceModule,
        sourceType: isCustomer ? 'customer_opening_balance' : 'supplier_opening_balance',
        sourceId: input.sourceId,
        legs,
        description: input.description,
        date: input.date,
        storeId: input.storeId,
    });
}
