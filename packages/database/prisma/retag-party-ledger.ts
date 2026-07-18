/**
 * Backfills party_id / party_type onto historical control-account voucher lines
 * that predate the party dimension (Phase 3, 2026-07-17). Those postings were
 * balanced and correct but carried no party tag, so the per-party GL ledger
 * (buildPartyLedger / reconcile:balances) silently omitted them — e.g. a supplier
 * whose purchases (Cr Purchase Payable) were untagged but whose payments were
 * tagged reads as a large negative balance.
 *
 * This is a RETAG, not a re-post: the vouchers already exist and balance. It only
 * stamps the party onto the leg that hits the party's control account — exactly
 * the leg autoPostFromRules tags today (the one whose Account.party_type matches),
 * never the cash/revenue side. The party is resolved from each voucher's source
 * document:
 *
 *   sale             -> Sale.customer_id                     (CUSTOMER)
 *   sale_return      -> SalesReturn.sale -> Sale.customer_id (CUSTOMER)
 *   customer_payment -> CustomerCreditTransaction.customer_id(CUSTOMER)
 *   purchase         -> Purchase.supplier_id                 (SUPPLIER)
 *   purchase_return  -> PurchaseReturn.supplier_id           (SUPPLIER)
 *   supplier_payment -> SupplierCreditTransaction.supplier_id(SUPPLIER)
 *
 * Safe by construction: only touches lines with party_id = NULL on an account
 * whose party_type matches the source's party type, so a second run tags 0
 * (idempotent). A line whose source row is gone or whose party FK is null is
 * left alone and reported. --dry-run writes nothing.
 *
 * Run this BEFORE reconcile:balances --rebuild — rebuilding from a still-untagged
 * GL would overwrite correct due_balance values with lopsided per-party totals.
 *
 * Usage:
 *   npx tsx prisma/retag-party-ledger.ts --dry-run
 *   npx tsx prisma/retag-party-ledger.ts --tenant=<id>
 *   npx tsx prisma/retag-party-ledger.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type PartyKind = 'CUSTOMER' | 'SUPPLIER';

/** source_type -> the party type its control leg belongs to. */
const SOURCE_PARTY_TYPE: Record<string, PartyKind> = {
    sale: 'CUSTOMER',
    sale_return: 'CUSTOMER',
    customer_payment: 'CUSTOMER',
    purchase: 'SUPPLIER',
    purchase_return: 'SUPPLIER',
    supplier_payment: 'SUPPLIER',
};
const PARTY_SOURCE_TYPES = Object.keys(SOURCE_PARTY_TYPE);

/** Resolve source_id -> party_id for one source_type (null when the FK/row is absent). */
async function partyMapFor(sourceType: string, ids: string[]): Promise<Map<string, string | null>> {
    switch (sourceType) {
        case 'sale': {
            const rows = await prisma.sale.findMany({ where: { id: { in: ids } }, select: { id: true, customer_id: true } });
            return new Map(rows.map((r) => [r.id, r.customer_id]));
        }
        case 'sale_return': {
            // SalesReturn has no customer_id of its own — the party is the returned sale's customer.
            const rows = await prisma.salesReturn.findMany({ where: { id: { in: ids } }, select: { id: true, sale: { select: { customer_id: true } } } });
            return new Map(rows.map((r) => [r.id, r.sale?.customer_id ?? null]));
        }
        case 'customer_payment': {
            const rows = await prisma.customerCreditTransaction.findMany({ where: { id: { in: ids } }, select: { id: true, customer_id: true } });
            return new Map(rows.map((r) => [r.id, r.customer_id]));
        }
        case 'purchase': {
            const rows = await prisma.purchase.findMany({ where: { id: { in: ids } }, select: { id: true, supplier_id: true } });
            return new Map(rows.map((r) => [r.id, r.supplier_id]));
        }
        case 'purchase_return': {
            const rows = await prisma.purchaseReturn.findMany({ where: { id: { in: ids } }, select: { id: true, supplier_id: true } });
            return new Map(rows.map((r) => [r.id, r.supplier_id]));
        }
        case 'supplier_payment': {
            const rows = await prisma.supplierCreditTransaction.findMany({ where: { id: { in: ids } }, select: { id: true, supplier_id: true } });
            return new Map(rows.map((r) => [r.id, r.supplier_id]));
        }
        default:
            return new Map();
    }
}

type TenantStats = {
    retaggedBySource: Map<string, number>;
    skippedNoParty: number; // source row/FK gone
    skippedTypeMismatch: number; // control account's party_type != source's (should be ~0)
};

async function retagTenant(tenantId: string, tenantName: string, dryRun: boolean): Promise<TenantStats> {
    const stats: TenantStats = { retaggedBySource: new Map(), skippedNoParty: 0, skippedTypeMismatch: 0 };

    // Control accounts: those that carry a party subsidiary ledger.
    const controlAccounts = await prisma.account.findMany({
        where: { tenant_id: tenantId, party_type: { not: null } },
        select: { id: true, party_type: true },
    });
    if (controlAccounts.length === 0) return stats;
    const partyTypeByAccount = new Map(controlAccounts.map((a) => [a.id, a.party_type as PartyKind]));

    // Untagged control-account lines whose voucher has a party-bearing source.
    const lines = await prisma.voucherDetail.findMany({
        where: {
            party_id: null,
            account_id: { in: controlAccounts.map((a) => a.id) },
            voucher: { tenant_id: tenantId, source_type: { in: PARTY_SOURCE_TYPES } },
        },
        select: { id: true, account_id: true, voucher: { select: { source_type: true, source_id: true } } },
    });
    if (lines.length === 0) return stats;

    // Group the source lookups by source_type, then resolve source_id -> party_id.
    const idsBySource = new Map<string, Set<string>>();
    for (const line of lines) {
        const st = line.voucher.source_type;
        if (!st || !line.voucher.source_id) continue;
        (idsBySource.get(st) ?? idsBySource.set(st, new Set()).get(st)!).add(line.voucher.source_id);
    }
    const partyBySource = new Map<string, Map<string, string | null>>();
    for (const [st, idSet] of idsBySource) {
        partyBySource.set(st, await partyMapFor(st, [...idSet]));
    }

    // Collect line-ids to update, keyed by resolved (partyType, partyId).
    const updates = new Map<string, { partyType: PartyKind; partyId: string; lineIds: string[] }>();
    for (const line of lines) {
        const st = line.voucher.source_type;
        const srcId = line.voucher.source_id;
        if (!st || !srcId) { stats.skippedNoParty++; continue; }

        const partyId = partyBySource.get(st)?.get(srcId) ?? null;
        if (!partyId) { stats.skippedNoParty++; continue; }

        const sourcePartyType = SOURCE_PARTY_TYPE[st];
        if (partyTypeByAccount.get(line.account_id) !== sourcePartyType) { stats.skippedTypeMismatch++; continue; }

        const key = `${sourcePartyType}:${partyId}`;
        const bucket = updates.get(key) ?? updates.set(key, { partyType: sourcePartyType, partyId, lineIds: [] }).get(key)!;
        bucket.lineIds.push(line.id);
        stats.retaggedBySource.set(st, (stats.retaggedBySource.get(st) ?? 0) + 1);
    }

    if (!dryRun) {
        for (const { partyType, partyId, lineIds } of updates.values()) {
            await prisma.voucherDetail.updateMany({
                where: { id: { in: lineIds } },
                data: { party_id: partyId, party_type: partyType },
            });
        }
    }

    return stats;
}

function tenantTotal(stats: TenantStats): number {
    let n = 0;
    for (const c of stats.retaggedBySource.values()) n += c;
    return n;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];

    const tenants = tenantId
        ? await prisma.tenant.findMany({ where: { id: tenantId }, select: { id: true, name: true } })
        : await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { created_at: 'asc' } });

    if (tenantId && tenants.length === 0) { console.error(`Tenant ${tenantId} not found.`); process.exit(1); }

    console.log(`Retag party ledger (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`);

    let grandRetagged = 0;
    let grandSkippedNoParty = 0;
    let grandSkippedMismatch = 0;

    for (const tenant of tenants) {
        const stats = await retagTenant(tenant.id, tenant.name, dryRun);
        const total = tenantTotal(stats);
        grandRetagged += total;
        grandSkippedNoParty += stats.skippedNoParty;
        grandSkippedMismatch += stats.skippedTypeMismatch;

        if (total === 0 && stats.skippedNoParty === 0 && stats.skippedTypeMismatch === 0) continue;

        console.log(`\n  ${tenant.name} (${tenant.id})`);
        for (const st of PARTY_SOURCE_TYPES) {
            const c = stats.retaggedBySource.get(st);
            if (c) console.log(`    ${st}: ${c} ${dryRun ? 'would retag' : 'retagged'}`);
        }
        if (stats.skippedNoParty > 0) console.log(`    skipped ${stats.skippedNoParty} (source row/party missing)`);
        if (stats.skippedTypeMismatch > 0) console.log(`    skipped ${stats.skippedTypeMismatch} (control account party_type mismatch)`);
    }

    console.log(
        `\nTotal: ${grandRetagged} line(s) ${dryRun ? 'would be retagged' : 'retagged'}` +
        (grandSkippedNoParty ? `, ${grandSkippedNoParty} skipped (no party)` : '') +
        (grandSkippedMismatch ? `, ${grandSkippedMismatch} skipped (type mismatch)` : ''),
    );
    if (grandRetagged === 0 && !dryRun) console.log('Nothing to do — every control line already carries its party.');
    if (dryRun) console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
    console.log('Next: re-run reconcile:balances to confirm the per-party GL now matches due_balance.');
}

main()
    .catch((error) => { console.error(error); process.exit(1); })
    .finally(() => prisma.$disconnect());
