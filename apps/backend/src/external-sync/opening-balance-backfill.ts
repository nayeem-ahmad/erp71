import { Prisma, PrismaClient } from '@prisma/client';
import { postPartyOpeningBalance } from '../accounting/party-opening-balance.posting';
import { AutoPostResult, isFiscalPeriodLockedError } from '../accounting/posting.utils';
import { openingBalanceNote } from './external-sync.impacts';

export interface OpeningBackfillRow {
    party: 'CUSTOMER' | 'SUPPLIER';
    rowId: string;
    partyId: string;
    amount: number;
    date: Date;
}

export interface OpeningBackfillReport {
    /** Posted — or, on a dry run, would post. */
    posted: OpeningBackfillRow[];
    alreadyPosted: number;
    /** No control account for the party: the workspace keeps no books for it. */
    skipped: OpeningBackfillRow[];
    /** Dated into a locked fiscal period. Unlock it and run again to include them. */
    locked: OpeningBackfillRow[];
    failed: Array<OpeningBackfillRow & { error: string }>;
}

/** Thrown inside a dry run's transaction to undo the posting. Never escapes. */
class DryRunRollback extends Error {
    constructor(readonly result: AutoPostResult) {
        super('dry run');
    }
}

/**
 * Posts the opening dues imported before `applyOpeningBalance` posted them.
 *
 * Those openings moved the party's `due_balance` and wrote their ledger row,
 * but put nothing in the books, so the GL-derived customer and supplier
 * ledgers close short of the party's due by exactly the opening. Each one gets
 * the voucher the importer now writes, dated at the opening and keyed on its
 * ledger row, so a second run skips what the first one posted.
 *
 * A dry run posts each one for real and rolls it back, so a locked month or a
 * missing account shows up in the preview exactly as it would live.
 */
export async function postImportedOpenings(
    db: PrismaClient,
    options: { tenantId: string; dryRun: boolean },
): Promise<OpeningBackfillReport> {
    const { tenantId, dryRun } = options;
    const where = { tenant_id: tenantId, type: 'ADJUSTMENT', notes: { startsWith: openingBalanceNote('') } };
    const select = { id: true, amount: true, created_at: true, store_id: true, notes: true };

    const [customerRows, supplierRows, postedEvents] = await Promise.all([
        db.customerCreditTransaction.findMany({ where, select: { ...select, customer_id: true }, orderBy: { created_at: 'asc' } }),
        db.supplierCreditTransaction.findMany({ where, select: { ...select, supplier_id: true }, orderBy: { created_at: 'asc' } }),
        db.postingEvent.findMany({
            where: { tenant_id: tenantId, event_type: 'party_opening_balance', status: 'posted', voucher_id: { not: null } },
            select: { source_id: true },
        }),
    ]);
    const posted = new Set(postedEvents.map((event) => event.source_id));

    const openings = [
        ...customerRows.map((row) => ({ ...row, party: 'CUSTOMER' as const, partyId: row.customer_id })),
        ...supplierRows.map((row) => ({ ...row, party: 'SUPPLIER' as const, partyId: row.supplier_id })),
    ];

    const report: OpeningBackfillReport = { posted: [], alreadyPosted: 0, skipped: [], locked: [], failed: [] };

    for (const opening of openings) {
        if (posted.has(opening.id)) {
            report.alreadyPosted++;
            continue;
        }

        const row: OpeningBackfillRow = {
            party: opening.party,
            rowId: opening.id,
            partyId: opening.partyId,
            amount: Number(opening.amount),
            date: opening.created_at,
        };

        let result: AutoPostResult;
        try {
            result = await db.$transaction(async (tx) => {
                const outcome = await postPartyOpeningBalance({
                    tx: tx as Prisma.TransactionClient,
                    tenantId,
                    party: row.party,
                    partyId: row.partyId,
                    amount: row.amount,
                    date: row.date,
                    sourceModule: 'external-sync',
                    sourceId: row.rowId,
                    storeId: opening.store_id ?? undefined,
                    description: opening.notes ?? openingBalanceNote('provider'),
                });
                if (dryRun) throw new DryRunRollback(outcome);
                return outcome;
            });
        } catch (error) {
            if (error instanceof DryRunRollback) {
                result = error.result;
            } else if (isFiscalPeriodLockedError(error)) {
                report.locked.push(row);
                continue;
            } else {
                report.failed.push({ ...row, error: error instanceof Error ? error.message : String(error) });
                continue;
            }
        }

        (result.postingStatus === 'posted' ? report.posted : report.skipped).push(row);
    }

    return report;
}
