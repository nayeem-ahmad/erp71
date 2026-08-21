import { Prisma } from '@prisma/client';

/**
 * Human-readable document numbers: `PI-2526-00001`, `IMP-2526-00007`.
 *
 * Two properties the callers depend on:
 *
 * 1. **Numbers are never reissued.** Quotations can be deleted, so the
 *    `count() + 1` pattern used elsewhere in the codebase would hand a fresh
 *    document the number a customer is already holding on a printed page. The
 *    counter is stored, not derived.
 * 2. **The series is legible.** `QT-1755764812345` (epoch millis, the previous
 *    quotation scheme) tells a shop owner nothing; `QT-2526-00042` tells them
 *    it is the 42nd quote of this fiscal year.
 */

/** Series a tenant can hold a counter for. */
export const DocumentSeries = {
    QUOTE: 'QUOTE',
    PROFORMA: 'PROFORMA',
    IMPORT_SHIPMENT: 'IMPORT_SHIPMENT',
} as const;

export type DocumentSeries = (typeof DocumentSeries)[keyof typeof DocumentSeries];

const SERIES_PREFIX: Record<DocumentSeries, string> = {
    QUOTE: 'QT',
    PROFORMA: 'PI',
    IMPORT_SHIPMENT: 'IMP',
};

/**
 * Bangladeshi fiscal year label for a date: July 2025–June 2026 is `2526`.
 *
 * Exported for the tests and for any report that wants to label a period the
 * same way the document numbers do. Uses local-time getters deliberately — the
 * fiscal year is a local calendar fact, and a UTC reading would put a document
 * created at 06:30 on 1 July into the previous year for a UTC+6 tenant.
 */
export function fiscalYearKey(date: Date): string {
    const year = date.getFullYear();
    // getMonth() is 0-indexed, so 6 is July.
    const startYear = date.getMonth() >= 6 ? year : year - 1;
    const two = (n: number) => String(n % 100).padStart(2, '0');
    return `${two(startYear)}${two(startYear + 1)}`;
}

/**
 * Reserves and returns the next number in a series.
 *
 * Must be called inside the same transaction as the row it numbers: the
 * `update` takes a row lock, so two concurrent creates serialise here rather
 * than both reading the same `next_number`. Reserving outside the transaction
 * would leave a gap in the series whenever the create that follows rolls back —
 * survivable, but only if nobody is auditing the sequence for gaps, and
 * somebody always is.
 */
export async function nextDocumentNumber(
    tx: Prisma.TransactionClient,
    params: {
        tenantId: string;
        series: DocumentSeries;
        /** Defaults to now. Passed explicitly by tests and by back-dated entry. */
        on?: Date;
        /** Set false for a series that should run continuously, never resetting. */
        resetsYearly?: boolean;
    },
): Promise<string> {
    const { tenantId, series } = params;
    const resetsYearly = params.resetsYearly ?? true;
    const periodKey = resetsYearly ? fiscalYearKey(params.on ?? new Date()) : '';
    const prefix = SERIES_PREFIX[series];

    const where = {
        tenant_id_doc_type_period_key: {
            tenant_id: tenantId,
            doc_type: series,
            period_key: periodKey,
        },
    };

    // upsert then update, rather than an upsert with `increment` in the update
    // branch: the create branch has to return 1 while the update branch returns
    // the pre-increment value, and only two statements can express both without
    // a race between reading and incrementing.
    await tx.documentSequence.upsert({
        where,
        update: {},
        create: {
            tenant_id: tenantId,
            doc_type: series,
            period_key: periodKey,
            prefix,
            next_number: 1,
        },
    });

    const reserved = await tx.documentSequence.update({
        where,
        data: { next_number: { increment: 1 } },
        select: { next_number: true },
    });

    // `update` returns the row *after* the increment, so the number this call
    // owns is one below what came back.
    const number = reserved.next_number - 1;
    const body = String(number).padStart(5, '0');

    return periodKey ? `${prefix}-${periodKey}-${body}` : `${prefix}-${body}`;
}
