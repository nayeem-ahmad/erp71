/**
 * Diffs each party's denormalized due_balance against the GL-derived balance of
 * their subsidiary ledger, so the two can be compared on real data before the
 * parallel CustomerCreditTransaction / SupplierCreditTransaction tables are ever
 * retired.
 *
 * GL-derived balance = the net of a party's tagged voucher lines on its control
 * account:
 *   - Customer receivable (AR, an asset): Σ(debit − credit)
 *   - Supplier payable   (AP, a liability): Σ(credit − debit)
 *
 * Report-only by default. A mismatch is not automatically a bug: GL and
 * due_balance legitimately diverge when a return exceeds what was owed (the GL
 * shows the real credit position; due_balance floors at zero), and before the
 * historical backfill (`backfill:vouchers`) has run, the GL is simply incomplete.
 * Read the diffs, run the backfill, re-run this — then, with `--rebuild`, set
 * due_balance to the GL value.
 *
 * Usage:
 *   npx tsx prisma/reconcile-party-balances.ts               # report all tenants
 *   npx tsx prisma/reconcile-party-balances.ts --tenant=<id>
 *   npx tsx prisma/reconcile-party-balances.ts --rebuild     # overwrite due_balance from GL
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TOLERANCE = 0.01;

type Mismatch = { id: string; name: string; due: number; gl: number };
type Side = { checked: number; mismatches: Mismatch[] };

/** Net GL balance per party on one control account, in the account's natural sign. */
async function glByParty(accountId: string, asset: boolean): Promise<Map<string, number>> {
    const rows = await prisma.voucherDetail.groupBy({
        by: ['party_id'],
        where: { account_id: accountId, party_id: { not: null } },
        _sum: { debit_amount: true, credit_amount: true },
    });
    const out = new Map<string, number>();
    for (const r of rows) {
        const debit = Number(r._sum.debit_amount ?? 0);
        const credit = Number(r._sum.credit_amount ?? 0);
        out.set(r.party_id!, asset ? debit - credit : credit - debit);
    }
    return out;
}

async function reconcileSide(
    controlAccountId: string,
    asset: boolean,
    parties: Array<{ id: string; name: string; due_balance: unknown }>,
    rebuild: boolean,
    update: (id: string, gl: number) => Promise<unknown>,
): Promise<Side> {
    const gl = await glByParty(controlAccountId, asset);
    const side: Side = { checked: parties.length, mismatches: [] };

    for (const party of parties) {
        const due = Number(party.due_balance);
        const glBalance = gl.get(party.id) ?? 0;
        if (Math.abs(due - glBalance) <= TOLERANCE) continue;

        side.mismatches.push({ id: party.id, name: party.name, due, gl: glBalance });
        if (rebuild) await update(party.id, glBalance);
    }
    return side;
}

async function reconcileTenant(tenantId: string, tenantName: string, rebuild: boolean): Promise<number> {
    const [ar, ap] = await Promise.all([
        prisma.account.findFirst({ where: { tenant_id: tenantId, party_type: 'CUSTOMER' }, select: { id: true } }),
        prisma.account.findFirst({ where: { tenant_id: tenantId, party_type: 'SUPPLIER' }, select: { id: true } }),
    ]);

    const [customers, suppliers] = await Promise.all([
        prisma.customer.findMany({ where: { tenant_id: tenantId }, select: { id: true, name: true, due_balance: true } }),
        prisma.supplier.findMany({ where: { tenant_id: tenantId, deleted_at: null }, select: { id: true, name: true, due_balance: true } }),
    ]);

    const custSide = ar
        ? await reconcileSide(ar.id, true, customers, rebuild, (id, gl) => prisma.customer.update({ where: { id }, data: { due_balance: gl } }))
        : { checked: 0, mismatches: [] };
    const supSide = ap
        ? await reconcileSide(ap.id, false, suppliers, rebuild, (id, gl) => prisma.supplier.update({ where: { id }, data: { due_balance: gl } }))
        : { checked: 0, mismatches: [] };

    const total = custSide.mismatches.length + supSide.mismatches.length;
    if (total === 0) return 0;

    console.log(`\n  ${tenantName} (${tenantId})`);
    for (const [label, side] of [['customer', custSide], ['supplier', supSide]] as const) {
        if (side.mismatches.length === 0) continue;
        console.log(`    ${label}s: ${side.mismatches.length}/${side.checked} ${rebuild ? 'rebuilt' : 'mismatched'}`);
        for (const m of side.mismatches.slice(0, 10)) {
            console.log(`      - ${m.name}: due_balance=${m.due.toFixed(2)} GL=${m.gl.toFixed(2)} diff=${(m.due - m.gl).toFixed(2)}`);
        }
        if (side.mismatches.length > 10) console.log(`      … and ${side.mismatches.length - 10} more`);
    }
    return total;
}

async function main() {
    const rebuild = process.argv.includes('--rebuild');
    const tenantId = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];

    const tenants = tenantId
        ? await prisma.tenant.findMany({ where: { id: tenantId }, select: { id: true, name: true } })
        : await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { created_at: 'asc' } });

    if (tenantId && tenants.length === 0) { console.error(`Tenant ${tenantId} not found.`); process.exit(1); }

    console.log(`Reconcile party balances (${rebuild ? 'REBUILD' : 'REPORT'}) — ${tenants.length} tenant(s)`);

    let total = 0;
    for (const tenant of tenants) total += await reconcileTenant(tenant.id, tenant.name, rebuild);

    if (total === 0) {
        console.log(`\nAll tenants reconcile — due_balance matches the GL for every party.`);
    } else {
        console.log(`\n${total} party balance(s) ${rebuild ? 'rebuilt from the GL' : 'differ from the GL'}.`);
        if (!rebuild) console.log('REPORT ONLY — nothing written. Run the backfill first, then re-run; use --rebuild to overwrite due_balance.');
    }
}

main()
    .catch((error) => { console.error(error); process.exit(1); })
    .finally(() => prisma.$disconnect());
