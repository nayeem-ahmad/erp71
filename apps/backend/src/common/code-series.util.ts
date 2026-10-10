import { Prisma } from '@prisma/client';

/**
 * The tables whose rows carry a per-tenant code people read and type — a
 * customer's code, a product's SKU, a supplier's code — and the series ERP71
 * numbers them in when no one has picked one: `CUST-00001`, `PRD-00001`,
 * `SUP-00001`. Each code is unique per tenant, deleted rows included.
 */
const SERIES = {
    Customer: { delegate: 'customer', column: 'customer_code', prefix: 'CUST-' },
    Product: { delegate: 'product', column: 'sku', prefix: 'PRD-' },
    Supplier: { delegate: 'supplier', column: 'supplier_code', prefix: 'SUP-' },
} as const;

export type SeriesTable = keyof typeof SERIES;

/** Prisma client or transaction client. */
type DbLike = any;

/** How many fresh numbers to try when someone else keeps taking the one just read. */
const ATTEMPTS = 5;

/**
 * The next code in the table's series for this tenant: one past the highest
 * number already in it, read as a number so `CUST-100000` follows `CUST-99999`
 * and a hand-typed `CUST-9` does not send the series back onto a taken code.
 */
export async function nextSeriesCode(db: DbLike, table: SeriesTable, tenantId: string): Promise<string> {
    const { column, prefix } = SERIES[table];
    const pattern = `^${prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}([0-9]+)$`;
    const rows: Array<{ last: string }> = await db.$queryRaw(Prisma.sql`
        SELECT COALESCE(MAX(substring(${Prisma.raw(`"${column}"`)} from ${pattern})::numeric), 0)::text AS last
        FROM ${Prisma.raw(`"${table}"`)}
        WHERE tenant_id = ${tenantId} AND ${Prisma.raw(`"${column}"`)} LIKE ${`${prefix}%`}
    `);
    const next = BigInt(rows[0]?.last ?? '0') + 1n;
    return `${prefix}${next.toString().padStart(5, '0')}`;
}

/** A unique-index clash on the table's code column (Prisma names the target by columns or by index). */
export function isCodeConflict(error: any, table: SeriesTable): boolean {
    if (error?.code !== 'P2002') return false;
    const target = error?.meta?.target;
    const column = SERIES[table].column;
    return Array.isArray(target) ? target.includes(column) : String(target ?? '').includes(column);
}

/**
 * Runs `create` with the code a new record gets: `preferred` — a code from the
 * record's source, such as the system an import came from — when no row of
 * this tenant holds it, else the next in the series. A clash at write time,
 * from someone saving the same code in between, moves on to a fresh number.
 */
export async function codeForNewRecord<T>(
    db: DbLike,
    table: SeriesTable,
    tenantId: string,
    preferred: string | null,
    create: (code: string) => Promise<T>,
): Promise<T> {
    const { delegate, column } = SERIES[table];
    let candidate = preferred;
    if (candidate) {
        const holder = await db[delegate].findFirst({
            where: { tenant_id: tenantId, [column]: candidate },
            select: { id: true },
        });
        if (holder) candidate = null;
    }

    for (let attempt = 1; ; attempt++) {
        const code = candidate ?? (await nextSeriesCode(db, table, tenantId));
        try {
            return await create(code);
        } catch (error) {
            if (!isCodeConflict(error, table) || attempt >= ATTEMPTS) throw error;
            candidate = null;
        }
    }
}
