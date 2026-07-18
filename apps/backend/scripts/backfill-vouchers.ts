/**
 * Backfills vouchers for historical source rows that never got one.
 *
 * Why this exists
 * ---------------
 * `sync:accounting` brought every tenant's posting RULES up to date, but it does
 * not touch history: a bKash sale booked on a pre-2026-07-16 tenant, or any
 * supplier payment booked before the supplier_payment event existed, still has no
 * voucher. This re-runs the posting for those rows so the ledger reflects them.
 *
 * Safe by construction:
 *   - autoPostFromRules is idempotent (keyed on tenant:eventType:sourceId), so a
 *     row that already posted short-circuits — re-running never double-posts.
 *   - A row whose historical date falls in a LOCKED fiscal period is left alone
 *     and reported, never force-posted. Unlock the period and re-run to include it.
 *   - --dry-run reports what WOULD post, per tenant, and writes nothing. This is
 *     the review gate: run it, read it per tenant, THEN run live.
 *
 * This CHANGES HISTORICAL REPORTS — deliberately, because those rows were missing
 * from the ledger. Review the dry run with the tenant owner before running live.
 *
 * Scope: sales and supplier payments — the two highest-volume historical gaps.
 * Customer payments, depreciation, salary, and cashier cash-outs are further
 * reposters to add (each needs its reconstruction checked against its caller).
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register scripts/backfill-vouchers.ts --dry-run
 *   ts-node -r tsconfig-paths/register scripts/backfill-vouchers.ts --tenant=<uuid>
 *   ts-node -r tsconfig-paths/register scripts/backfill-vouchers.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });

import { BadRequestException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { autoPostFromRules, AutoPostInput } from '../src/accounting/posting.utils';
import { classifyPaymentMode } from '../src/sales/classify-payment-mode';
import { creditDueAmount } from '../src/customers/customer-credit.utils';

const prisma = new PrismaClient();

type PostInput = Omit<AutoPostInput, 'tx'>;
type Candidate = { sourceId: string; label: string; input: PostInput };
type Stats = { posted: number; alreadyPosted: number; lockedSkipped: number; failed: number };

const isLocked = (error: unknown) =>
    error instanceof BadRequestException && String(error.message).includes('FISCAL_PERIOD_LOCKED');

/** A source type that can be re-posted: how to find its un-posted rows. */
interface Reposter {
    name: string;
    findCandidates(tenantId: string): Promise<Candidate[]>;
}

async function postedSourceIds(tenantId: string, sourceModule: string, sourceType: string): Promise<Set<string>> {
    const events = await prisma.postingEvent.findMany({
        where: { tenant_id: tenantId, source_module: sourceModule, source_type: sourceType, status: 'posted' },
        select: { source_id: true },
    });
    return new Set(events.map((e) => e.source_id));
}

const salesReposter: Reposter = {
    name: 'sales',
    async findCandidates(tenantId) {
        const posted = await postedSourceIds(tenantId, 'sales', 'sale');
        const sales = await prisma.sale.findMany({
            where: { tenant_id: tenantId },
            include: { payments: { orderBy: { created_at: 'asc' }, take: 1 } },
        });

        const candidates: Candidate[] = [];
        for (const sale of sales) {
            if (posted.has(sale.id)) continue;

            const total = Number(sale.total_amount);
            const balanceDue = creditDueAmount(total, Number(sale.amount_paid));
            // Mirrors sales.service: a credit sale posts its credit portion to AR;
            // otherwise the full total posts to the classified payment mode. (The
            // partial paid-portion is dropped in live code today — Phase 6 — so the
            // backfill matches it rather than introducing a divergent history.)
            const base = {
                tenantId,
                eventType: 'sale' as const,
                conditionKey: 'payment_mode' as const,
                sourceModule: 'sales',
                sourceType: 'sale',
                sourceId: sale.id,
                referenceNumber: sale.serial_number,
                date: sale.sale_date ?? sale.created_at,
                storeId: sale.store_id,
            };

            const input: PostInput = balanceDue > 0.005
                ? { ...base, conditionValue: 'credit', amount: balanceDue, description: `Backfill credit sale ${sale.serial_number}`, partyType: 'CUSTOMER', partyId: sale.customer_id ?? undefined }
                : { ...base, conditionValue: classifyPaymentMode(sale.payments[0]?.payment_method ?? 'cash'), amount: total, description: `Backfill sale ${sale.serial_number}` };

            candidates.push({ sourceId: sale.id, label: `${sale.serial_number} (${input.conditionValue})`, input });
        }
        return candidates;
    },
};

const supplierPaymentReposter: Reposter = {
    name: 'supplier-payments',
    async findCandidates(tenantId) {
        const posted = await postedSourceIds(tenantId, 'suppliers', 'supplier_payment');
        // Only PAYMENT/PAYOUT settle cash; CREDIT_PURCHASE mirrors the Purchase
        // (which posts) and ADJUSTMENT mirrors a purchase return.
        const txns = await prisma.supplierCreditTransaction.findMany({
            where: { tenant_id: tenantId, type: { in: ['PAYMENT', 'PAYOUT'] } },
            include: { supplier: { select: { name: true } } },
        });

        return txns.filter((t) => !posted.has(t.id)).map((t) => ({
            sourceId: t.id,
            label: `${t.payment_number ?? t.id} (${t.type})`,
            input: {
                tenantId,
                eventType: 'supplier_payment',
                conditionKey: 'payment_direction',
                conditionValue: t.type === 'PAYMENT' ? 'pay' : 'receive',
                sourceModule: 'suppliers',
                sourceType: 'supplier_payment',
                sourceId: t.id,
                amount: Number(t.amount),
                description: `Backfill supplier ${t.type === 'PAYMENT' ? 'payment' : 'receipt'} — ${t.supplier.name}`,
                referenceNumber: t.payment_number ?? undefined,
                date: t.created_at,
                partyType: 'SUPPLIER',
                partyId: t.supplier_id,
            },
        }));
    },
};

const REPOSTERS: Reposter[] = [salesReposter, supplierPaymentReposter];

function reportDryRun(name: string, candidates: Candidate[]): void {
    console.log(`    ${name}: ${candidates.length} row(s) would post`);
    for (const c of candidates.slice(0, 5)) console.log(`      - ${c.label}`);
    if (candidates.length > 5) console.log(`      … and ${candidates.length - 5} more`);
}

async function repostAll(name: string, candidates: Candidate[]): Promise<Stats> {
    const s: Stats = { posted: 0, alreadyPosted: 0, lockedSkipped: 0, failed: 0 };
    for (const c of candidates) {
        try {
            const result = await prisma.$transaction(async (tx) => autoPostFromRules({ ...c.input, tx: tx as Prisma.TransactionClient }));
            if (result.postingStatus === 'posted') s.posted++; else s.alreadyPosted++;
        } catch (error) {
            if (isLocked(error)) { s.lockedSkipped++; continue; }
            s.failed++;
            console.error(`    ${name} ${c.label}: ${(error as Error).message}`);
        }
    }
    return s;
}

async function backfillTenant(tenantId: string, tenantName: string, dryRun: boolean): Promise<Stats> {
    const total: Stats = { posted: 0, alreadyPosted: 0, lockedSkipped: 0, failed: 0 };
    let headerPrinted = false;
    const header = () => {
        if (!headerPrinted) { console.log(`\n  ${tenantName} (${tenantId})`); headerPrinted = true; }
    };

    for (const reposter of REPOSTERS) {
        const candidates = await reposter.findCandidates(tenantId);
        if (candidates.length === 0) continue;
        header();

        if (dryRun) {
            reportDryRun(reposter.name, candidates);
            total.posted += candidates.length;
            continue;
        }

        const s = await repostAll(reposter.name, candidates);
        total.posted += s.posted; total.alreadyPosted += s.alreadyPosted;
        total.lockedSkipped += s.lockedSkipped; total.failed += s.failed;
        console.log(`    ${reposter.name}: +${s.posted} posted, ${s.lockedSkipped} in locked periods, ${s.failed} failed`);
    }
    return total;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];

    const tenants = tenantId
        ? await prisma.tenant.findMany({ where: { id: tenantId }, select: { id: true, name: true } })
        : await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { created_at: 'asc' } });

    if (tenantId && tenants.length === 0) { console.error(`Tenant ${tenantId} not found.`); process.exit(1); }

    console.log(`Backfill vouchers (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`);

    const total: Stats = { posted: 0, alreadyPosted: 0, lockedSkipped: 0, failed: 0 };
    for (const tenant of tenants) {
        const s = await backfillTenant(tenant.id, tenant.name, dryRun);
        total.posted += s.posted; total.lockedSkipped += s.lockedSkipped; total.failed += s.failed;
    }

    console.log(
        `\nTotal: ${dryRun ? 'would post' : 'posted'} ${total.posted}` +
        (total.lockedSkipped ? `, ${total.lockedSkipped} in locked periods (unlock + re-run to include)` : '') +
        (total.failed ? `, ${total.failed} failed` : ''),
    );
    if (dryRun) console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
}

main()
    .catch((error) => { console.error(error); process.exit(1); })
    .finally(() => prisma.$disconnect());
