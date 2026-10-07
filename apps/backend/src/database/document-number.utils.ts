import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    DEFAULT_DOCUMENT_NUMBERING,
    NUMBERING_RESET_POLICIES,
    fiscalYearLabel,
    numberingMatcher,
    numberingPeriodKey,
    numberingScopesFor,
    renderDocumentNumber,
    templateUsesToken,
    type DocumentNumberingConfig,
    type NumberingDocType,
    type NumberingRenderContext,
    type NumberingResetPolicy,
    type NumberingScope,
} from '@erp71/shared-types';
import { resolveZone, zonedParts } from '../common/tenant-time.util';
import { ensureStoreCode } from '../stores/store-code.util';
import { DOCUMENT_NUMBER_SOURCES } from './document-number-sources';

/**
 * Human-readable document numbers: `INV-2627-00042`, `PUR-01849`.
 *
 * Two properties the callers depend on:
 *
 * 1. **Numbers are never reissued.** Quotations can be deleted, so the
 *    `count() + 1` pattern purchases used would hand a fresh document the
 *    number a customer or supplier is already holding on a printed page. The
 *    counter is stored, not derived.
 * 2. **The series is legible.** `QT-1755764812345` (epoch millis, the previous
 *    quotation scheme) tells a shop owner nothing; `QT-2526-00042` tells them
 *    it is the 42nd quote of this fiscal year.
 *
 * Two entry points. `issueDocumentNumber` issues a series the tenant formats
 * itself under Settings → Document Numbering (sales, quotations, proforma
 * invoices, purchases). `nextDocumentNumber` issues the one fixed series left,
 * import shipments.
 */

/** Series that still have a fixed format. */
export const DocumentSeries = {
    IMPORT_SHIPMENT: 'IMPORT_SHIPMENT',
} as const;

export type DocumentSeries = (typeof DocumentSeries)[keyof typeof DocumentSeries];

const SERIES_PREFIX: Record<DocumentSeries, string> = {
    IMPORT_SHIPMENT: 'IMP',
};

/**
 * How many times `issueDocumentNumber` finds its candidate already in use
 * before giving up. Each collision moves the counter past every number in use
 * after it, so a second one only happens when another transaction claims a
 * number in between — a handful at most. Running out means something else is
 * wrong, and saying so beats a loop.
 */
const MAX_COLLISIONS = 5;

type SequenceKey = { tenantId: string; docType: string; periodKey: string; scopeKey: string };

const sequenceWhere = (key: SequenceKey) => ({
    tenant_id_doc_type_period_key_scope_key: {
        tenant_id: key.tenantId,
        doc_type: key.docType,
        period_key: key.periodKey,
        scope_key: key.scopeKey,
    },
});

/**
 * Reserves the next number of one counter and returns it.
 *
 * Must run inside the same transaction as the row it numbers: the `update`
 * takes a row lock, so two concurrent creates serialise here rather than both
 * reading the same `next_number`. Reserving outside the transaction would leave
 * a gap in the series whenever the create that follows rolls back — survivable,
 * but only if nobody is auditing the sequence for gaps, and somebody always is.
 */
async function reserveSequenceNumber(
    tx: Prisma.TransactionClient,
    key: SequenceKey,
    prefix: string,
): Promise<number> {
    // Create-if-missing then increment, rather than one upsert. Prisma's upsert
    // here is a read followed by an insert, so two transactions starting the
    // same counter at once (the first two sales of a month, or of a new till)
    // both saw no row and the second died on the unique index. `skipDuplicates`
    // is INSERT … ON CONFLICT DO NOTHING: the second insert waits for the
    // first transaction instead, then does nothing, and the update below takes
    // its turn on the row lock.
    await tx.documentSequence.createMany({
        data: [{
            tenant_id: key.tenantId,
            doc_type: key.docType,
            period_key: key.periodKey,
            scope_key: key.scopeKey,
            prefix,
            next_number: 1,
        }],
        skipDuplicates: true,
    });

    const reserved = await tx.documentSequence.update({
        where: sequenceWhere(key),
        data: { next_number: { increment: 1 } },
        select: { next_number: true },
    });

    // `update` returns the row *after* the increment, so the number this call
    // owns is one below what came back.
    return reserved.next_number - 1;
}

/**
 * Reserves and returns the next import shipment number. See
 * `reserveSequenceNumber` for why it must run inside the creating transaction.
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
    let periodKey = '';
    if (resetsYearly) {
        const date = await tenantCalendarMonth(tx, tenantId, params.on ?? new Date());
        periodKey = fiscalYearLabel(date.year, date.month);
    }
    const prefix = SERIES_PREFIX[series];

    const number = await reserveSequenceNumber(tx, { tenantId, docType: series, periodKey, scopeKey: '' }, prefix);
    const body = String(number).padStart(5, '0');

    return periodKey ? `${prefix}-${periodKey}-${body}` : `${prefix}-${body}`;
}

/** A tenant's saved format for one document type, or the built-in default. */
export async function loadNumberingConfig(
    tx: Prisma.TransactionClient,
    tenantId: string,
    docType: NumberingDocType,
): Promise<{ config: DocumentNumberingConfig; isDefault: boolean }> {
    const row = await tx.documentNumbering.findUnique({
        where: { tenant_id_doc_type: { tenant_id: tenantId, doc_type: docType } },
    });
    if (!row) {
        return { config: { ...DEFAULT_DOCUMENT_NUMBERING[docType] }, isDefault: true };
    }
    // The page validates before saving; these guards only keep a hand-edited
    // row from turning into a document that cannot be numbered.
    const fallback = DEFAULT_DOCUMENT_NUMBERING[docType];
    const resetPolicy = (NUMBERING_RESET_POLICIES as readonly string[]).includes(row.reset_policy)
        ? (row.reset_policy as NumberingResetPolicy)
        : fallback.resetPolicy;
    const scope = (numberingScopesFor(docType) as string[]).includes(row.scope)
        ? (row.scope as NumberingScope)
        : fallback.scope;
    return {
        config: { template: row.template, resetPolicy, scope, seqWidth: row.seq_width },
        isDefault: false,
    };
}

/**
 * The calendar year and month of an instant in the tenant's own timezone. Not
 * the server's: the container runs in UTC, which would put a document raised
 * at 00:30 on 1 July in Dhaka into the previous fiscal year.
 */
export async function tenantCalendarMonth(
    tx: Prisma.TransactionClient,
    tenantId: string,
    on: Date,
): Promise<{ year: number; month: number }> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const date = zonedParts(on, resolveZone(tenant?.timezone)).date;
    return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/**
 * Which counter a document draws from, for the tenant's scope. A sale on no
 * POS counter, under per-counter numbering, draws from its branch's "no
 * counter" series rather than from any one till's.
 */
export function numberingScopeKey(
    scope: NumberingScope,
    target: { storeId: string; counterId?: string | null },
): string {
    switch (scope) {
        case 'STORE':
            return `store:${target.storeId}`;
        case 'COUNTER':
            return target.counterId ? `counter:${target.counterId}` : `store:${target.storeId}:none`;
        default:
            return '';
    }
}

/**
 * The first number at or after `from` that no document of this type already
 * prints for this counter. Used when a candidate turns out to be taken — and
 * by the settings page, to show where a counter will really continue.
 *
 * Purchases are why this has to look at the documents rather than trust the
 * counter: they were numbered `count() + 1` before they had one, so a tenant's
 * first configured purchase finds `PUR-00001`…`PUR-01848` already printed and
 * must continue at 1849, not walk the 1848 numbers one at a time.
 */
export async function firstUnusedNumber(
    tx: Prisma.TransactionClient,
    params: {
        tenantId: string;
        docType: NumberingDocType;
        config: DocumentNumberingConfig;
        ctx: NumberingRenderContext;
        from: number;
    },
): Promise<number> {
    const { prefix, seqOf } = numberingMatcher(params.config, params.ctx);
    const numbers = await DOCUMENT_NUMBER_SOURCES[params.docType].numbersStartingWith(tx, params.tenantId, prefix);
    const used = new Set<number>();
    for (const number of numbers) {
        const seq = seqOf(number);
        if (seq !== null) used.add(seq);
    }
    let next = Math.max(1, params.from);
    while (used.has(next)) next += 1;
    return next;
}

/**
 * Reserves and returns the next number of a tenant-formatted series.
 *
 * Runs inside the transaction that creates the document, for the same reason
 * as `nextDocumentNumber`. A candidate already in use — typed by hand as a
 * reference, printed by an earlier format, or one of the purchases numbered
 * before there was a counter — moves the counter past it rather than stopping
 * the document on a unique violation.
 */
export async function issueDocumentNumber(
    tx: Prisma.TransactionClient,
    params: {
        tenantId: string;
        docType: NumberingDocType;
        storeId: string;
        /** The POS counter the document was raised on, if any. */
        counterId?: string | null;
        /** The document's date. Defaults to now. */
        on?: Date;
    },
): Promise<string> {
    const { tenantId, docType, storeId } = params;
    const { config } = await loadNumberingConfig(tx, tenantId, docType);
    const date = await tenantCalendarMonth(tx, tenantId, params.on ?? new Date());

    const storeCode = templateUsesToken(config.template, 'STORE')
        ? await ensureStoreCode(tx, tenantId, storeId)
        : null;

    // Read inside the tenant: the counter id can come from the client when no
    // cashier session is open, and one from elsewhere must not name a series.
    const needsCounter = config.scope === 'COUNTER' || templateUsesToken(config.template, 'COUNTER');
    const counter = needsCounter && params.counterId
        ? await tx.posCounter.findFirst({
            where: { id: params.counterId, tenant_id: tenantId },
            select: { id: true, counter_number: true },
        })
        : null;

    const ctx: NumberingRenderContext = { ...date, storeCode, counterNumber: counter?.counter_number ?? null };
    const key: SequenceKey = {
        tenantId,
        docType,
        periodKey: numberingPeriodKey(config.resetPolicy, date),
        scopeKey: numberingScopeKey(config.scope, { storeId, counterId: counter?.id ?? null }),
    };
    const source = DOCUMENT_NUMBER_SOURCES[docType];

    for (let attempt = 0; attempt < MAX_COLLISIONS; attempt += 1) {
        const seq = await reserveSequenceNumber(tx, key, config.template);
        const candidate = renderDocumentNumber(config, seq, ctx);
        if (!(await source.isTaken(tx, tenantId, candidate))) {
            return candidate;
        }
        // This transaction holds the counter's row lock from the increment
        // above, so moving it here cannot race another issuer.
        const next = await firstUnusedNumber(tx, { tenantId, docType, config, ctx, from: seq + 1 });
        await tx.documentSequence.update({ where: sequenceWhere(key), data: { next_number: next } });
    }

    throw new ConflictException(
        'Could not find an unused document number. Check the format under Settings → Document Numbering.',
    );
}
