import { Prisma } from '@prisma/client';
import type { NumberingDocType } from '@erp71/shared-types';

/**
 * Where each tenant-formatted document type keeps the numbers it has printed,
 * so the numbering engine can tell whether a candidate is free and where a
 * counter really has to continue from. One entry per `NUMBERING_DOC_TYPES`.
 */
export interface DocumentNumberSource {
    /** Whether any document of this type already carries `candidate`. */
    isTaken(tx: Prisma.TransactionClient, tenantId: string, candidate: string): Promise<boolean>;
    /** Every number of this type that starts with `prefix`. */
    numbersStartingWith(tx: Prisma.TransactionClient, tenantId: string, prefix: string): Promise<string[]>;
}

/**
 * Sales: the invoice number, and the reference a user typed. The printed
 * invoice shows the reference when there is one, so a new invoice number must
 * not repeat either.
 */
const sales: DocumentNumberSource = {
    async isTaken(tx, tenantId, candidate) {
        const found = await tx.sale.findFirst({
            where: { tenant_id: tenantId, OR: [{ serial_number: candidate }, { reference_number: candidate }] },
            select: { id: true },
        });
        return Boolean(found);
    },
    async numbersStartingWith(tx, tenantId, prefix) {
        const rows = await tx.sale.findMany({
            where: {
                tenant_id: tenantId,
                OR: [{ serial_number: { startsWith: prefix } }, { reference_number: { startsWith: prefix } }],
            },
            select: { serial_number: true, reference_number: true },
        });
        return rows.flatMap((row) => [row.serial_number, row.reference_number ?? '']);
    },
};

/**
 * Quotations and proforma invoices share one table and one number column, and
 * a revision keeps its quote's number, so "taken" means any row with it — of
 * either kind, so two formats that happen to print alike cannot collide.
 */
const quotations: DocumentNumberSource = {
    async isTaken(tx, tenantId, candidate) {
        const found = await tx.quotation.findFirst({
            where: { tenant_id: tenantId, quote_number: candidate },
            select: { id: true },
        });
        return Boolean(found);
    },
    async numbersStartingWith(tx, tenantId, prefix) {
        const rows = await tx.quotation.findMany({
            where: { tenant_id: tenantId, quote_number: { startsWith: prefix } },
            select: { quote_number: true },
            distinct: ['quote_number'],
        });
        return rows.map((row) => row.quote_number);
    },
};

/**
 * Purchases: our own number only. `reference_number` is the supplier's bill
 * number, which repeats across suppliers and is never printed as ours.
 */
const purchases: DocumentNumberSource = {
    async isTaken(tx, tenantId, candidate) {
        const found = await tx.purchase.findFirst({
            where: { tenant_id: tenantId, purchase_number: candidate },
            select: { id: true },
        });
        return Boolean(found);
    },
    async numbersStartingWith(tx, tenantId, prefix) {
        const rows = await tx.purchase.findMany({
            where: { tenant_id: tenantId, purchase_number: { startsWith: prefix } },
            select: { purchase_number: true },
        });
        return rows.map((row) => row.purchase_number);
    },
};

export const DOCUMENT_NUMBER_SOURCES: Record<NumberingDocType, DocumentNumberSource> = {
    SALE: sales,
    QUOTE: quotations,
    PROFORMA: quotations,
    PURCHASE: purchases,
};
