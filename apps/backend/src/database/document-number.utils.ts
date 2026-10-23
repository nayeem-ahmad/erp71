import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    DEFAULT_DOCUMENT_NUMBERING,
    NUMBERING_RESET_POLICIES,
    NUMBERING_SCOPES,
    numberingPeriodKey,
    renderDocumentNumber,
    templateUsesToken,
    type DocumentNumberingConfig,
    type NumberingDocType,
    type NumberingResetPolicy,
    type NumberingScope,
} from '@erp71/shared-types';
import { resolveZone, zonedParts } from '../common/tenant-time.util';
import { ensureStoreCode } from '../stores/store-code.util';

/**
 * Human-readable document numbers: `INV-2627-00042`, `PUR-00042`, `DHK/2610/0007`.
 *
 * Two properties the callers depend on:
 *
 * 1. **Numbers are never reissued.** Documents can be deleted, so the
 *    `count() + 1` pattern this replaced handed a fresh document the number a
 *    deleted one had printed — and once the count fell below the highest
 *    number, every create hit the unique index on a number still in use. The
 *    counter is stored, not derived.
 * 2. **The series is legible.** `RET-1755764812345` (epoch millis, the old
 *    returns scheme) tells a shop owner nothing; `RET-2627-00042` tells them
 *    it is the 42nd return of this fiscal year.
 *
 * Every document type is numbered by `issueDocumentNumber`, in the format the
 * tenant chose under Settings → Document Numbering or the type's built-in
 * default (`DEFAULT_DOCUMENT_NUMBERING` in shared-types).
 */

/**
 * How many already-used numbers `issueDocumentNumber` steps over before giving
 * up. A used number only turns up after an owner raises "next number" past
 * numbers typed by hand, changes format onto an older one, or the previous
 * release's count-based code numbered a few documents during a deploy's swap —
 * a handful at most. Running out means something else is wrong, and saying so beats a loop.
 */
const MAX_TAKEN_SKIPS = 50;

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
    params: { tenantId: string; docType: string; periodKey: string; scopeKey: string; prefix: string },
): Promise<number> {
    const where = {
        tenant_id_doc_type_period_key_scope_key: {
            tenant_id: params.tenantId,
            doc_type: params.docType,
            period_key: params.periodKey,
            scope_key: params.scopeKey,
        },
    };

    // Create-if-missing then increment, rather than one upsert. Prisma's upsert
    // here is a read followed by an insert, so two transactions starting the
    // same counter at once (the first two sales of a month, or of a new till)
    // both saw no row and the second died on the unique index. `skipDuplicates`
    // is INSERT … ON CONFLICT DO NOTHING: the second insert waits for the
    // first transaction instead, then does nothing, and the update below takes
    // its turn on the row lock.
    await tx.documentSequence.createMany({
        data: [{
            tenant_id: params.tenantId,
            doc_type: params.docType,
            period_key: params.periodKey,
            scope_key: params.scopeKey,
            prefix: params.prefix,
            next_number: 1,
        }],
        skipDuplicates: true,
    });

    const reserved = await tx.documentSequence.update({
        where,
        data: { next_number: { increment: 1 } },
        select: { next_number: true },
    });

    // `update` returns the row *after* the increment, so the number this call
    // owns is one below what came back.
    return reserved.next_number - 1;
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
    // row from turning into a sale that cannot be numbered.
    const resetPolicy = (NUMBERING_RESET_POLICIES as readonly string[]).includes(row.reset_policy)
        ? (row.reset_policy as NumberingResetPolicy)
        : DEFAULT_DOCUMENT_NUMBERING[docType].resetPolicy;
    const scope = (NUMBERING_SCOPES as readonly string[]).includes(row.scope)
        ? (row.scope as NumberingScope)
        : DEFAULT_DOCUMENT_NUMBERING[docType].scope;
    return {
        config: { template: row.template, resetPolicy, scope, seqWidth: row.seq_width },
        isDefault: false,
    };
}

/**
 * The calendar year and month of an instant in the tenant's own timezone. Not
 * the server's: the container runs in UTC, which would put a sale rung up at
 * 00:30 on 1 July in Dhaka into the previous fiscal year.
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
 * Reserves and returns the next number of a tenant-formatted series.
 *
 * Runs inside the transaction that creates the document; see
 * `reserveSequenceNumber`. `isTaken` lets the caller step over a number that
 * is already in use — one typed by hand, or left by an earlier format that
 * happened to print the same way — so a format change can never stop a sale at
 * the till on a unique violation. It should check the whole unique column the
 * number goes into, including rows numbered under another type that shares it.
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
        isTaken?: (candidate: string) => Promise<boolean>;
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

    const periodKey = numberingPeriodKey(config.resetPolicy, date);
    const scopeKey = numberingScopeKey(config.scope, { storeId, counterId: counter?.id ?? null });

    for (let attempt = 0; attempt <= MAX_TAKEN_SKIPS; attempt += 1) {
        const seq = await reserveSequenceNumber(tx, {
            tenantId,
            docType,
            periodKey,
            scopeKey,
            prefix: config.template,
        });
        const candidate = renderDocumentNumber(config, seq, {
            ...date,
            storeCode,
            counterNumber: counter?.counter_number ?? null,
        });
        if (!params.isTaken || !(await params.isTaken(candidate))) {
            return candidate;
        }
    }

    throw new ConflictException(
        'Could not find an unused document number. Check the format under Settings → Document Numbering.',
    );
}

/**
 * The usual `isTaken`: whether any of the tenant's rows already holds the
 * candidate in the unique column the number goes into. Deleted rows count —
 * their number may already be on paper.
 */
export function numberTakenIn(
    delegate: { findFirst: (args: any) => Promise<unknown> },
    tenantId: string,
    column: string,
): (candidate: string) => Promise<boolean> {
    return async (candidate) => Boolean(await delegate.findFirst({
        where: { tenant_id: tenantId, [column]: candidate },
        select: { id: true },
    }));
}
