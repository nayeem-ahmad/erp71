import type { PrismaClient } from '@prisma/client';

/**
 * Who prepared each sale, by name — the "Prepared By" line on a printed
 * invoice.
 *
 * `Sale.created_by` is a bare user id with no relation, so the names are
 * fetched in one query for however many sales are being printed. Falls back to
 * the email for an account that never set a name, and to `null` for a sale
 * with no creator (an import) or a user that no longer exists — the invoice
 * then prints the line empty rather than failing.
 */
export async function loadPreparerNames(
    db: Pick<PrismaClient, 'user'>,
    sales: { created_by?: string | null }[],
): Promise<Map<string, string>> {
    const ids = [...new Set(sales.flatMap((sale) => (sale.created_by ? [sale.created_by] : [])))];
    if (ids.length === 0) return new Map();

    const users = await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
    });
    return new Map(users.flatMap((user) => {
        const label = user.name?.trim() || user.email;
        return label ? [[user.id, label] as [string, string]] : [];
    }));
}

/** The name `loadPreparerNames` found for this sale, or null. */
export function preparerOf(
    names: Map<string, string>,
    sale: { created_by?: string | null },
): string | null {
    return (sale.created_by && names.get(sale.created_by)) || null;
}
