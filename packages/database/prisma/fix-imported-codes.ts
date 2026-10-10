/**
 * Renames the long codes an Express Retail / Dizi import wrote before
 * 2026-10-11 (see fix-imported-codes.utils.ts):
 *
 *   product SKU     EXT-…, a GUID, or a long hex id   → PRD-00001, …
 *   customer code   EXT-…, a GUID, or a long hex id   → CUST-00001, …
 *   either          P01139-<row id> (a repeat)        → P01139-2, …
 *   supplier name   Acme-<row id> (a repeat)          → Acme (2), …
 *
 * Only records the import created or linked (those with an import mapping) are
 * looked at; a code someone typed in ERP71 is never touched. A re-import does
 * not undo this: an import updates a mapped record's name and prices, never
 * its SKU or code, and finds it again through the mapping.
 *
 * One-off, never part of db-prepare. Lists what it would change unless given
 * --apply; with it, each tenant's renames run in one transaction. Take a
 * backup first (scripts/vps-backup.sh). A barcode label printed from an old
 * SKU stops scanning once the SKU changes.
 *
 * Usage, inside the backend container on the VPS:
 *   npm run fix:imported-codes --workspace=@erp71/database                          # every tenant, list only
 *   npm run fix:imported-codes --workspace=@erp71/database -- --tenant=<uuid>       # one tenant, list only
 *   npm run fix:imported-codes --workspace=@erp71/database -- --tenant=<uuid> --apply
 */

import { PrismaClient } from '@prisma/client';
import { ImportedRecord, Rename, planCodeRenames, planNameRenames } from './fix-imported-codes.utils';

const prisma = new PrismaClient();

type Kind = 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER';

interface TenantPlan {
    tenantId: string;
    tenantName: string;
    products: Rename[];
    customers: Rename[];
    suppliers: Rename[];
}

/** The records of one kind the import maps for this tenant, with the value to look at. */
function imported(
    mappings: Array<{ entity_type: string; external_id: string; internal_id: string }>,
    kind: Kind,
    rows: Array<{ id: string; value: string | null }>,
): ImportedRecord[] {
    const byId = new Map(rows.map((row) => [row.id, row.value]));
    const seen = new Set<string>();
    const records: ImportedRecord[] = [];
    for (const mapping of mappings) {
        if (mapping.entity_type !== kind || seen.has(mapping.internal_id)) continue;
        const value = byId.get(mapping.internal_id);
        if (!value) continue;
        seen.add(mapping.internal_id);
        records.push({ id: mapping.internal_id, externalId: mapping.external_id, value });
    }
    return records;
}

async function planTenant(tenantId: string, tenantName: string): Promise<TenantPlan> {
    const mappings = await prisma.externalSyncMapping.findMany({
        where: { tenant_id: tenantId, entity_type: { in: ['PRODUCT', 'CUSTOMER', 'SUPPLIER'] } },
        select: { entity_type: true, external_id: true, internal_id: true },
        orderBy: { created_at: 'asc' },
    });

    // Every row, deleted ones included: the unique indexes span them.
    const [products, customers, suppliers] = await Promise.all([
        prisma.product.findMany({ where: { tenant_id: tenantId }, select: { id: true, sku: true } }),
        prisma.customer.findMany({ where: { tenant_id: tenantId }, select: { id: true, customer_code: true } }),
        prisma.supplier.findMany({ where: { tenant_id: tenantId }, select: { id: true, name: true } }),
    ]);

    const productRows = products.map((p) => ({ id: p.id, value: p.sku }));
    const customerRows = customers.map((c) => ({ id: c.id, value: c.customer_code }));
    const supplierRows = suppliers.map((s) => ({ id: s.id, value: s.name }));
    const held = (rows: Array<{ value: string | null }>) =>
        new Set(rows.map((row) => row.value).filter((v): v is string => Boolean(v)));

    return {
        tenantId,
        tenantName,
        products: planCodeRenames(imported(mappings, 'PRODUCT', productRows), held(productRows), 'PRD-'),
        customers: planCodeRenames(imported(mappings, 'CUSTOMER', customerRows), held(customerRows), 'CUST-'),
        suppliers: planNameRenames(imported(mappings, 'SUPPLIER', supplierRows), held(supplierRows)),
    };
}

function report(plan: TenantPlan) {
    const total = plan.products.length + plan.customers.length + plan.suppliers.length;
    console.log(`\n${plan.tenantName} (${plan.tenantId}): ${total} rename(s)`);
    const section = (label: string, renames: Rename[]) => {
        if (renames.length === 0) return;
        console.log(`  ${label} (${renames.length})`);
        for (const r of renames) console.log(`    ${r.from}  →  ${r.to}`);
    };
    section('Product SKUs', plan.products);
    section('Customer codes', plan.customers);
    section('Supplier names', plan.suppliers);
}

async function apply(plan: TenantPlan) {
    await prisma.$transaction(
        [
            ...plan.products.map((r) => prisma.product.update({ where: { id: r.id }, data: { sku: r.to } })),
            ...plan.customers.map((r) => prisma.customer.update({ where: { id: r.id }, data: { customer_code: r.to } })),
            ...plan.suppliers.map((r) => prisma.supplier.update({ where: { id: r.id }, data: { name: r.to } })),
        ],
    );
}

async function main() {
    const write = process.argv.includes('--apply');
    const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))?.slice('--tenant='.length);

    const tenants = await prisma.tenant.findMany({
        where: tenantArg ? { id: tenantArg } : { externalSyncMappings: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
    if (tenantArg && tenants.length === 0) throw new Error(`No tenant ${tenantArg}`);

    let total = 0;
    for (const tenant of tenants) {
        const plan = await planTenant(tenant.id, tenant.name);
        const count = plan.products.length + plan.customers.length + plan.suppliers.length;
        if (count === 0) continue;
        report(plan);
        total += count;
        if (write) {
            await apply(plan);
            console.log('  applied');
        }
    }

    console.log(
        total === 0
            ? '\n[fix-imported-codes] Nothing to rename.'
            : write
              ? `\n[fix-imported-codes] Renamed ${total} record(s).`
              : `\n[fix-imported-codes] ${total} record(s) would be renamed. Nothing written: add --apply to rename.`,
    );
}

main()
    .catch((error) => {
        console.error('[fix-imported-codes] Failed:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
