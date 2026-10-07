import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    NUMBERING_DOC_TYPES,
    NUMBERING_RESET_POLICIES,
    normalizeStoreCode,
    numberingPeriodKey,
    templateUsesToken,
    validateNumberingConfig,
    type DocumentNumberingConfig,
    type NumberingDocType,
} from '@erp71/shared-types';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import {
    firstUnusedNumber,
    loadNumberingConfig,
    numberingScopeKey,
    tenantCalendarMonth,
} from '../database/document-number.utils';
import { ensureStoreCode } from '../stores/store-code.util';
import type { TenantContext } from '../database/tenant.decorator';
import type { DocumentNumberingResponse, UpdateDocumentNumberingDto } from './document-numbering.dto';

@Injectable()
export class DocumentNumberingService {
    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
    ) {}

    async get(tenantId: string, docType: string): Promise<DocumentNumberingResponse> {
        return this.read(this.db, tenantId, this.requireDocType(docType));
    }

    /**
     * Saves the format, any branch-code changes and any "continue from" numbers
     * in one transaction: a format that prints `{STORE}` and the codes it
     * prints belong together, and half of that change would issue numbers in a
     * shape nobody chose.
     */
    async update(
        ctx: TenantContext,
        docTypeParam: string,
        dto: UpdateDocumentNumberingDto,
    ): Promise<DocumentNumberingResponse> {
        const docType = this.requireDocType(docTypeParam);
        const tenantId = ctx.tenantId;
        const config: DocumentNumberingConfig = {
            template: dto.template.trim(),
            resetPolicy: dto.resetPolicy,
            scope: dto.scope,
            seqWidth: dto.seqWidth,
        };

        const problems = validateNumberingConfig(config, docType);
        if (problems.length > 0) {
            throw new BadRequestException(problems.join(' '));
        }

        const result = await this.db.$transaction(async (tx) => {
            const before = await loadNumberingConfig(tx, tenantId, docType);

            await this.applyStoreCodes(tx, tenantId, dto.storeCodes ?? []);
            if (templateUsesToken(config.template, 'STORE')) {
                // A branch with no code would print an empty segment.
                const uncoded = await tx.store.findMany({
                    where: { tenant_id: tenantId, code: null },
                    select: { id: true },
                });
                for (const store of uncoded) {
                    await ensureStoreCode(tx, tenantId, store.id);
                }
            }

            await tx.documentNumbering.upsert({
                where: { tenant_id_doc_type: { tenant_id: tenantId, doc_type: docType } },
                update: {
                    template: config.template,
                    reset_policy: config.resetPolicy,
                    scope: config.scope,
                    seq_width: config.seqWidth,
                },
                create: {
                    tenant_id: tenantId,
                    doc_type: docType,
                    template: config.template,
                    reset_policy: config.resetPolicy,
                    scope: config.scope,
                    seq_width: config.seqWidth,
                },
            });

            await this.applyNextNumbers(tx, tenantId, docType, config, dto.nextNumbers ?? []);

            return { before: before.config, response: await this.read(tx, tenantId, docType) };
        });

        await this.audit.log(
            'document_numbering.updated',
            'DocumentNumbering',
            { userId: ctx.userId, tenantId },
            docType,
            {
                before: result.before,
                after: config,
                storeCodes: dto.storeCodes ?? [],
                nextNumbers: dto.nextNumbers ?? [],
            },
        );

        return result.response;
    }

    private requireDocType(docType: string): NumberingDocType {
        const upper = String(docType ?? '').toUpperCase();
        if (!(NUMBERING_DOC_TYPES as readonly string[]).includes(upper)) {
            throw new NotFoundException('Unknown document type.');
        }
        return upper as NumberingDocType;
    }

    private async read(
        client: Prisma.TransactionClient,
        tenantId: string,
        docType: NumberingDocType,
    ): Promise<DocumentNumberingResponse> {
        const [{ config, isDefault }, today, stores, counters] = await Promise.all([
            loadNumberingConfig(client, tenantId, docType),
            tenantCalendarMonth(client, tenantId, new Date()),
            client.store.findMany({
                where: { tenant_id: tenantId },
                select: { id: true, name: true, code: true },
                orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            }),
            client.posCounter.findMany({
                where: { tenant_id: tenantId, status: 'ACTIVE' },
                select: { id: true, store_id: true, name: true, counter_number: true },
                orderBy: [{ store_id: 'asc' }, { counter_number: 'asc' }],
            }),
        ]);

        const currentPeriods = NUMBERING_RESET_POLICIES.map((policy) => numberingPeriodKey(policy, today));
        const rows = await client.documentSequence.findMany({
            where: { tenant_id: tenantId, doc_type: docType, period_key: { in: currentPeriods } },
            select: { period_key: true, scope_key: true, next_number: true },
        });
        const sequences = new Map(rows.map((row) => [`${row.period_key}|${row.scope_key}`, {
            periodKey: row.period_key,
            scopeKey: row.scope_key,
            nextNumber: row.next_number,
        }]));

        // For the saved format, where each counter will really continue: past
        // any number already printed in that shape, which the counter alone
        // does not know about until it runs into one. Purchases numbered before
        // they had a counter are the case that matters — their next is 1849,
        // not the 1 an unstarted counter would say.
        const savedPeriod = numberingPeriodKey(config.resetPolicy, today);
        for (const target of this.targets(config, stores, counters)) {
            const key = `${savedPeriod}|${target.scopeKey}`;
            const from = sequences.get(key)?.nextNumber ?? 1;
            const nextNumber = await firstUnusedNumber(client, {
                tenantId,
                docType,
                config,
                ctx: { ...today, storeCode: target.storeCode, counterNumber: target.counterNumber },
                from,
            });
            sequences.set(key, { periodKey: savedPeriod, scopeKey: target.scopeKey, nextNumber });
        }

        return {
            docType,
            config,
            isDefault,
            today,
            stores,
            counters: counters.map((c) => ({
                id: c.id,
                storeId: c.store_id,
                name: c.name,
                counterNumber: c.counter_number,
            })),
            sequences: [...sequences.values()],
        };
    }

    /**
     * The counters a format draws from, with what each prints for `{STORE}` and
     * `{COUNTER}` — the same rows the settings page lists. A business-wide
     * series is shown with the first branch's code, as the page previews it.
     */
    private targets(
        config: DocumentNumberingConfig,
        stores: { id: string; code: string | null }[],
        counters: { id: string; store_id: string; counter_number: number }[],
    ): { scopeKey: string; storeCode: string | null; counterNumber: number | null }[] {
        if (config.scope === 'TENANT') {
            return [{ scopeKey: '', storeCode: stores[0]?.code ?? null, counterNumber: null }];
        }
        if (config.scope === 'STORE') {
            return stores.map((store) => ({
                scopeKey: numberingScopeKey('STORE', { storeId: store.id }),
                storeCode: store.code,
                counterNumber: null,
            }));
        }
        return stores.flatMap((store) => [
            ...counters
                .filter((counter) => counter.store_id === store.id)
                .map((counter) => ({
                    scopeKey: numberingScopeKey('COUNTER', { storeId: store.id, counterId: counter.id }),
                    storeCode: store.code,
                    counterNumber: counter.counter_number,
                })),
            { scopeKey: numberingScopeKey('COUNTER', { storeId: store.id, counterId: null }), storeCode: store.code, counterNumber: null },
        ]);
    }

    /**
     * Renames branch codes. Changed rows are cleared first and then written, so
     * two branches can swap codes without tripping the unique index halfway.
     */
    private async applyStoreCodes(
        tx: Prisma.TransactionClient,
        tenantId: string,
        changes: { storeId: string; code: string }[],
    ): Promise<void> {
        if (changes.length === 0) return;

        const stores = await tx.store.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, code: true },
        });
        const byId = new Map(stores.map((s) => [s.id, s]));
        const finalCodes = new Map(stores.map((s) => [s.id, s.code]));

        for (const change of changes) {
            const store = byId.get(change.storeId);
            if (!store) throw new BadRequestException('Store not found.');
            const code = normalizeStoreCode(change.code);
            if (!code) {
                throw new BadRequestException(
                    `Branch code for ${store.name} must be 1–6 letters or digits.`,
                );
            }
            finalCodes.set(store.id, code);
        }

        const seen = new Map<string, string>();
        for (const [storeId, code] of finalCodes) {
            if (!code) continue;
            const other = seen.get(code);
            if (other) {
                throw new ConflictException(
                    `${byId.get(other)?.name} and ${byId.get(storeId)?.name} cannot both use the code ${code}.`,
                );
            }
            seen.set(code, storeId);
        }

        const changed = [...finalCodes].filter(([id, code]) => byId.get(id)?.code !== code);
        if (changed.length === 0) return;

        await tx.store.updateMany({
            where: { tenant_id: tenantId, id: { in: changed.map(([id]) => id) } },
            data: { code: null },
        });
        for (const [id, code] of changed) {
            await tx.store.update({ where: { id }, data: { code } });
        }
    }

    /**
     * Moves the current period's counters forward — for a shop moving over from
     * another system, whose next invoice is #1848, not #1. Never backward: the
     * numbers below the current one may already be on paper. (Forward past
     * numbers already printed is not checked here: the engine steps over them.)
     */
    private async applyNextNumbers(
        tx: Prisma.TransactionClient,
        tenantId: string,
        docType: NumberingDocType,
        config: DocumentNumberingConfig,
        changes: { scopeKey: string; nextNumber: number }[],
    ): Promise<void> {
        if (changes.length === 0) return;

        const today = await tenantCalendarMonth(tx, tenantId, new Date());
        const periodKey = numberingPeriodKey(config.resetPolicy, today);
        const validKeys = await this.scopeKeysFor(tx, tenantId, config);

        for (const change of changes) {
            if (!validKeys.has(change.scopeKey)) {
                throw new BadRequestException('That counter does not belong to the chosen series.');
            }
            const key = {
                tenant_id: tenantId,
                doc_type: docType,
                period_key: periodKey,
                scope_key: change.scopeKey,
            };
            const current = await tx.documentSequence.findUnique({
                where: { tenant_id_doc_type_period_key_scope_key: key },
                select: { next_number: true },
            });
            const currentNext = current?.next_number ?? 1;
            if (change.nextNumber === currentNext) continue;
            if (change.nextNumber < currentNext) {
                throw new BadRequestException(
                    `The next number cannot go back below ${currentNext}: lower numbers may already be printed.`,
                );
            }

            // Same create-if-missing as the engine, so a document starting this
            // counter at the same moment waits rather than failing.
            await tx.documentSequence.createMany({
                data: [{ ...key, prefix: config.template, next_number: 1 }],
                skipDuplicates: true,
            });
            // Conditional, so a document issued between the read above and this
            // write is never numbered again: the counter only ever moves up.
            const { count } = await tx.documentSequence.updateMany({
                where: { ...key, next_number: { lte: change.nextNumber } },
                data: { next_number: change.nextNumber },
            });
            if (count === 0) {
                throw new ConflictException(
                    'Documents were issued while you were editing and the counter has moved past that number. Reload and try again.',
                );
            }
        }
    }

    /** Every counter a format's scope can draw from, for this tenant. */
    private async scopeKeysFor(
        tx: Prisma.TransactionClient,
        tenantId: string,
        config: DocumentNumberingConfig,
    ): Promise<Set<string>> {
        if (config.scope === 'TENANT') return new Set(['']);

        const stores = await tx.store.findMany({ where: { tenant_id: tenantId }, select: { id: true } });
        if (config.scope === 'STORE') {
            return new Set(stores.map((s) => numberingScopeKey('STORE', { storeId: s.id })));
        }

        const counters = await tx.posCounter.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, store_id: true },
        });
        return new Set([
            ...stores.map((s) => numberingScopeKey('COUNTER', { storeId: s.id, counterId: null })),
            ...counters.map((c) => numberingScopeKey('COUNTER', { storeId: c.store_id, counterId: c.id })),
        ]);
    }
}
