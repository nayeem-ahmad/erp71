import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Reports the REAL posting status of a source row, from PostingEvent.
 *
 * The read paths used to infer it from voucher existence:
 *
 *     posting_status: voucher ? 'posted' : 'skipped'
 *
 * which collapses four states into two. A `failed` posting — a misconfigured rule
 * that threw — rendered as "Skipped", identical to a deliberate no-op, so a real
 * accounting failure was invisible in the UI and looked like a routine decision.
 * `pending` had the same problem.
 *
 * Reads PostingEvent, which is the actual record of what the posting engine
 * decided, and carries last_error explaining why. Indexed by
 * @@index([tenant_id, source_module, source_type, source_id]).
 */

type Client = PrismaClient | Prisma.TransactionClient;

export type PostingSummary = {
    posting_status: string;
    posting_error: string | null;
    voucher_id: string | null;
    voucher_number: string | null;
    voucher_type: string | null;
};

/**
 * No PostingEvent row at all — the source predates auto-posting, or its event was
 * removed by voidAutoPostedVoucher. Not the same as a deliberate 'skipped', but
 * indistinguishable after the fact, and 'skipped' is what these rows have always
 * reported. Kept as the fallback so this change fixes the failed-as-skipped lie
 * without silently reclassifying historical rows.
 */
export const NO_POSTING_EVENT: PostingSummary = {
    posting_status: 'skipped',
    posting_error: null,
    voucher_id: null,
    voucher_number: null,
    voucher_type: null,
};

export async function loadPostingSummaries(
    db: Client,
    tenantId: string,
    sourceModule: string,
    sourceType: string,
    sourceIds: string[],
): Promise<Map<string, PostingSummary>> {
    if (sourceIds.length === 0) return new Map();

    const events = await db.postingEvent.findMany({
        where: {
            tenant_id: tenantId,
            source_module: sourceModule,
            source_type: sourceType,
            source_id: { in: sourceIds },
        },
        select: {
            source_id: true,
            status: true,
            last_error: true,
            idempotency_key: true,
            voucher: { select: { id: true, voucher_number: true, voucher_type: true } },
        },
    });

    // A source may have more than one posting event — a partial credit sale posts
    // a keyless PRIMARY leg (the receivable) plus a legKey leg (the cash). The
    // primary represents the source's status: its idempotency key ends with the
    // source id, whereas a leg key appends a suffix (":paid"). Prefer it.
    const summaries = new Map<string, PostingSummary>();
    for (const event of events) {
        const isPrimary = event.idempotency_key.endsWith(`:${event.source_id}`);
        if (summaries.has(event.source_id) && !isPrimary) continue;
        summaries.set(event.source_id, {
            posting_status: event.status,
            posting_error: event.last_error,
            voucher_id: event.voucher?.id ?? null,
            voucher_number: event.voucher?.voucher_number ?? null,
            voucher_type: event.voucher?.voucher_type ?? null,
        });
    }
    return summaries;
}

export async function loadPostingSummary(
    db: Client,
    tenantId: string,
    sourceModule: string,
    sourceType: string,
    sourceId: string,
): Promise<PostingSummary> {
    const summaries = await loadPostingSummaries(db, tenantId, sourceModule, sourceType, [sourceId]);
    return summaries.get(sourceId) ?? NO_POSTING_EVENT;
}
