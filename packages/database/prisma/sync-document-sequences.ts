/**
 * Starts each running document series past the numbers already in use, so the
 * first purchase numbered by the engine is `PUR-01849`, not `PUR-00001` again.
 *
 * Why this exists
 * ---------------
 * Purchases, purchase returns, purchase orders, RFQs, warehouse transfers,
 * stock takes and shrinkage were numbered `count(rows) + 1`. They now draw from
 * a stored counter (`document_sequences`, see apps/backend's
 * document-number.utils.ts) in the same `PUR-00042` shape, and a counter that
 * does not exist starts at 1. The engine steps over a number already taken,
 * but only a handful of times; a tenant with 1,848 purchases would run out of
 * steps long before reaching a free one. This writes each counter where the
 * old series left off.
 *
 * What it touches
 * ---------------
 * Only the never-resetting, business-wide counter (`period_key = ''`,
 * `scope_key = ''`) of each type, for tenants still numbering in the default
 * shape — no saved format, or a saved one identical to the default. A counter
 * only ever moves up, so a re-run, or a run after the engine has issued
 * numbers, changes nothing it should not. Numbers wider than nine digits are
 * ignored: the counter is an INTEGER, and no count-based series got that far.
 *
 * Idempotent, and safe while the old backend serves: a number the old code
 * issues between this prepare and the swap is stepped over by the engine.
 * Raw SQL, because the generated client may describe columns the database
 * does not have yet; tolerates the tables being absent.
 *
 * Usage:
 *   npx tsx prisma/sync-document-sequences.ts --dry-run   # report only
 *   npx tsx prisma/sync-document-sequences.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * The count-based series, as the code that numbered them wrote them. Must
 * match `DEFAULT_DOCUMENT_NUMBERING` in shared-types (prefix + `{SEQ}`, never
 * resetting, business-wide) — a different default would leave these seeded
 * counters unread.
 */
export const RUNNING_SERIES = [
    { docType: 'PURCHASE', table: 'Purchase', column: 'purchase_number', prefix: 'PUR' },
    { docType: 'PURCHASE_RETURN', table: 'PurchaseReturn', column: 'return_number', prefix: 'PRET' },
    { docType: 'PURCHASE_ORDER', table: 'PurchaseOrder', column: 'po_number', prefix: 'PO' },
    { docType: 'RFQ', table: 'PurchaseQuotation', column: 'rfq_number', prefix: 'RFQ' },
    { docType: 'WAREHOUSE_TRANSFER', table: 'WarehouseTransfer', column: 'transfer_number', prefix: 'TRF' },
    { docType: 'STOCK_TAKE', table: 'StockTakeSession', column: 'session_number', prefix: 'STK' },
    { docType: 'SHRINKAGE', table: 'InventoryShrinkage', column: 'reference_number', prefix: 'SHR' },
    { docType: 'STOCK_FOUND', table: 'InventoryShrinkage', column: 'reference_number', prefix: 'FND' },
] as const;

type Series = (typeof RUNNING_SERIES)[number];

/** Each tenant's next number in the old series, for tenants still on the default format. */
function nextNumbersSql(series: Series): string {
    const { docType, table, column, prefix } = series;
    return `
        SELECT d."tenant_id",
               MAX(CAST(SUBSTRING(d."${column}" FROM '^${prefix}-([0-9]{1,9})$') AS INTEGER)) + 1 AS next_number
        FROM "${table}" AS d
        WHERE d."${column}" ~ '^${prefix}-[0-9]{1,9}$'
          AND NOT EXISTS (
              SELECT 1 FROM "document_numbering" AS n
              WHERE n."tenant_id" = d."tenant_id"
                AND n."doc_type" = '${docType}'
                AND NOT (n."template" = '${prefix}-{SEQ}' AND n."reset_policy" = 'NEVER' AND n."scope" = 'TENANT')
          )
        GROUP BY d."tenant_id"
    `;
}

/** Counters this run would create or move up. */
export function pendingSql(series: Series): string {
    return `
        SELECT COUNT(*)::bigint AS count
        FROM (${nextNumbersSql(series)}) AS seed
        LEFT JOIN "document_sequences" AS s
          ON s."tenant_id" = seed."tenant_id" AND s."doc_type" = '${series.docType}'
         AND s."period_key" = '' AND s."scope_key" = ''
        WHERE s."id" IS NULL OR s."next_number" < seed.next_number
    `;
}

export function seedSql(series: Series): string {
    return `
        INSERT INTO "document_sequences"
            ("id", "tenant_id", "doc_type", "period_key", "scope_key", "prefix", "next_number", "created_at", "updated_at")
        SELECT gen_random_uuid()::text, seed."tenant_id", '${series.docType}', '', '', '${series.prefix}-{SEQ}',
               seed.next_number, NOW(), NOW()
        FROM (${nextNumbersSql(series)}) AS seed
        ON CONFLICT ("tenant_id", "doc_type", "period_key", "scope_key")
        DO UPDATE SET "next_number" = EXCLUDED."next_number", "updated_at" = NOW()
        WHERE "document_sequences"."next_number" < EXCLUDED."next_number"
    `;
}

async function tableExists(name: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ found: string | null }>>`SELECT to_regclass(${`"${name}"`})::text AS found`;
    return rows[0]?.found != null;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    for (const table of ['document_sequences', 'document_numbering']) {
        if (!(await tableExists(table))) {
            console.log(`[sync-document-sequences] No ${table} table yet — nothing to do.`);
            return;
        }
    }

    let total = 0;
    for (const series of RUNNING_SERIES) {
        if (!(await tableExists(series.table))) continue;
        const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(pendingSql(series));
        const pending = Number(rows[0]?.count ?? 0);
        if (pending === 0) continue;
        total += pending;
        if (dryRun) {
            console.log(`[sync-document-sequences] --dry-run: would start ${pending} ${series.docType} counter(s) past existing numbers.`);
            continue;
        }
        const written = await prisma.$executeRawUnsafe(seedSql(series));
        console.log(`[sync-document-sequences] Started ${written} ${series.docType} counter(s) past existing numbers.`);
    }

    if (total === 0) {
        console.log('[sync-document-sequences] Every running series is already past its numbers. Nothing to do.');
    } else if (dryRun) {
        console.log('[sync-document-sequences] --dry-run: no changes made.');
    }
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error('[sync-document-sequences] Failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
