import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentNumberingService } from './document-numbering.service';

const CTX = { tenantId: 't1', userId: 'u1' } as any;

function makeDb(options: {
    numbering?: any;
    stores?: { id: string; name: string; code: string | null }[];
    counters?: { id: string; store_id: string; name: string; counter_number: number; status?: string }[];
    sequences?: { period_key: string; scope_key: string; next_number: number }[];
    /** Purchase numbers already printed. */
    purchases?: string[];
} = {}) {
    const purchases = options.purchases ?? [];
    const stores = (options.stores ?? [{ id: 'store-1', name: 'Main', code: 'S1' }]).map((s) => ({ ...s }));
    const counters = options.counters ?? [];
    const sequences = (options.sequences ?? []).map((s) => ({ ...s }));

    const tx: any = {
        stores,
        sequences,
        documentNumbering: {
            findUnique: jest.fn().mockResolvedValue(options.numbering ?? null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        // 7 October 2026 in Dhaka, whatever the test machine's clock says.
        tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Dhaka' }) },
        store: {
            findMany: jest.fn(async ({ where }: any) => stores.filter((s) => (where?.code === null ? s.code === null : true))),
            findFirst: jest.fn(async ({ where }: any) => stores.find((s) => s.id === where.id) ?? null),
            update: jest.fn(async ({ where, data }: any) => {
                const store = stores.find((s) => s.id === where.id)!;
                if (data.code && stores.some((s) => s.id !== store.id && s.code === data.code)) {
                    throw new Error('unique violation on (tenant_id, code)');
                }
                Object.assign(store, data);
                return store;
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const ids: string[] | undefined = where.id?.in ?? (where.id ? [where.id] : undefined);
                let count = 0;
                for (const store of stores) {
                    if (ids && !ids.includes(store.id)) continue;
                    if (where.code === null && store.code !== null) continue;
                    Object.assign(store, data);
                    count += 1;
                }
                return { count };
            }),
        },
        // What the engine reads to see where a counter really continues.
        sale: { findMany: jest.fn().mockResolvedValue([]) },
        quotation: { findMany: jest.fn().mockResolvedValue([]) },
        purchase: {
            findMany: jest.fn(async ({ where }: any) => purchases
                .filter((n) => n.startsWith(where.purchase_number.startsWith))
                .map((purchase_number) => ({ purchase_number }))),
        },
        posCounter: {
            findMany: jest.fn(async () => counters.filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')),
        },
        documentSequence: {
            findMany: jest.fn(async ({ where }: any) => sequences.filter((s) => where.period_key.in.includes(s.period_key))),
            findUnique: jest.fn(async ({ where }: any) => {
                const k = where.tenant_id_doc_type_period_key_scope_key;
                return sequences.find((s) => s.period_key === k.period_key && s.scope_key === k.scope_key) ?? null;
            }),
            createMany: jest.fn(async ({ data }: any) => {
                const row = data[0];
                if (sequences.some((s) => s.period_key === row.period_key && s.scope_key === row.scope_key)) {
                    return { count: 0 };
                }
                sequences.push({ period_key: row.period_key, scope_key: row.scope_key, next_number: row.next_number });
                return { count: 1 };
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const row = sequences.find((s) => s.period_key === where.period_key && s.scope_key === where.scope_key);
                if (!row || row.next_number > where.next_number.lte) return { count: 0 };
                row.next_number = data.next_number;
                return { count: 1 };
            }),
        },
    };
    const db: any = { ...tx, $transaction: jest.fn((fn: any) => fn(tx)) };
    return { db, tx };
}

describe('DocumentNumberingService', () => {
    const audit = { log: jest.fn() };

    beforeAll(() => {
        jest.useFakeTimers({ now: new Date('2026-10-07T04:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    });
    afterAll(() => jest.useRealTimers());
    beforeEach(() => jest.clearAllMocks());

    const valid = { template: 'INV-{FY}-{SEQ}', resetPolicy: 'FISCAL_YEAR' as const, scope: 'TENANT' as const, seqWidth: 5 };

    describe('get', () => {
        it('reports the default, the tenant today, branches, counters and this period\'s counters', async () => {
            const { db } = makeDb({
                stores: [{ id: 'store-1', name: 'Main', code: 'S1' }],
                counters: [
                    { id: 'till-1', store_id: 'store-1', name: 'Front', counter_number: 1 },
                    { id: 'till-9', store_id: 'store-1', name: 'Closed', counter_number: 9, status: 'INACTIVE' },
                ],
                sequences: [
                    { period_key: '2627', scope_key: '', next_number: 43 },
                    { period_key: '2526', scope_key: '', next_number: 900 },
                ],
            });
            const service = new DocumentNumberingService(db, audit as any);

            const result = await service.get('t1', 'sale');

            expect(result).toEqual({
                docType: 'SALE',
                config: valid,
                isDefault: true,
                today: { year: 2026, month: 10 },
                stores: [{ id: 'store-1', name: 'Main', code: 'S1' }],
                counters: [{ id: 'till-1', storeId: 'store-1', name: 'Front', counterNumber: 1 }],
                // Last year's counter is history, not something the page edits.
                sequences: [{ periodKey: '2627', scopeKey: '', nextNumber: 43 }],
            });
        });

        it('shows purchases continuing after the ones numbered before there was a counter', async () => {
            const { db } = makeDb({ purchases: ['PUR-00001', 'PUR-00002', 'PUR-00003', 'PUR-IMP-2526-00001'] });
            const service = new DocumentNumberingService(db, audit as any);

            const result = await service.get('t1', 'purchase');

            expect(result.config).toEqual({ template: 'PUR-{SEQ}', resetPolicy: 'NEVER', scope: 'TENANT', seqWidth: 5 });
            expect(result.sequences).toEqual([{ periodKey: '', scopeKey: '', nextNumber: 4 }]);
        });

        it('refuses a document type that is not configurable', async () => {
            const service = new DocumentNumberingService(makeDb().db, audit as any);
            await expect(service.get('t1', 'IMPORT_SHIPMENT')).rejects.toThrow(NotFoundException);
        });
    });

    describe('update', () => {
        it('saves a valid format and audit-logs the change', async () => {
            const { db, tx } = makeDb();
            const service = new DocumentNumberingService(db, audit as any);

            await service.update(CTX, 'SALE', { ...valid, template: ' BILL-{FY}-{SEQ} ' });

            expect(tx.documentNumbering.upsert).toHaveBeenCalledWith(expect.objectContaining({
                create: expect.objectContaining({ tenant_id: 't1', doc_type: 'SALE', template: 'BILL-{FY}-{SEQ}' }),
            }));
            expect(audit.log).toHaveBeenCalledWith(
                'document_numbering.updated',
                'DocumentNumbering',
                { userId: 'u1', tenantId: 't1' },
                'SALE',
                expect.objectContaining({ after: expect.objectContaining({ template: 'BILL-{FY}-{SEQ}' }) }),
            );
        });

        it('refuses a format that would repeat numbers, before touching anything', async () => {
            const { db, tx } = makeDb();
            const service = new DocumentNumberingService(db, audit as any);

            await expect(service.update(CTX, 'SALE', { ...valid, template: 'INV-{SEQ}' }))
                .rejects.toThrow(/fiscal-year reset needs \{FY\}/);
            await expect(service.update(CTX, 'SALE', { ...valid, scope: 'STORE' }))
                .rejects.toThrow(BadRequestException);
            expect(db.$transaction).not.toHaveBeenCalled();
            expect(tx.documentNumbering.upsert).not.toHaveBeenCalled();
        });

        it('refuses POS counters for a document that is not rung up at one', async () => {
            const { db } = makeDb();
            const service = new DocumentNumberingService(db, audit as any);

            await expect(service.update(CTX, 'QUOTE', {
                template: '{STORE}{COUNTER}-{FY}-{SEQ}', resetPolicy: 'FISCAL_YEAR', scope: 'COUNTER', seqWidth: 5,
            })).rejects.toThrow(/not rung up at a POS counter/);
        });

        it('lets two branches swap codes', async () => {
            const { db, tx } = makeDb({
                stores: [{ id: 'a', name: 'Dhaka', code: 'S1' }, { id: 'b', name: 'Ctg', code: 'S2' }],
            });
            const service = new DocumentNumberingService(db, audit as any);

            await service.update(CTX, 'SALE', {
                ...valid,
                storeCodes: [{ storeId: 'a', code: 's2' }, { storeId: 'b', code: 'S1' }],
            });

            expect(tx.stores).toEqual([
                { id: 'a', name: 'Dhaka', code: 'S2' },
                { id: 'b', name: 'Ctg', code: 'S1' },
            ]);
        });

        it('refuses a code another branch keeps', async () => {
            const { db } = makeDb({
                stores: [{ id: 'a', name: 'Dhaka', code: 'DHK' }, { id: 'b', name: 'Ctg', code: 'S2' }],
            });
            const service = new DocumentNumberingService(db, audit as any);

            await expect(service.update(CTX, 'SALE', { ...valid, storeCodes: [{ storeId: 'b', code: 'dhk' }] }))
                .rejects.toThrow(ConflictException);
        });

        it('refuses a code that cannot be printed, and a branch from elsewhere', async () => {
            const { db } = makeDb();
            const service = new DocumentNumberingService(db, audit as any);

            await expect(service.update(CTX, 'SALE', { ...valid, storeCodes: [{ storeId: 'store-1', code: 'DH-K' }] }))
                .rejects.toThrow(/1–6 letters or digits/);
            await expect(service.update(CTX, 'SALE', { ...valid, storeCodes: [{ storeId: 'other', code: 'X' }] }))
                .rejects.toThrow(/Store not found/);
        });

        it('codes every branch when the new format prints {STORE}', async () => {
            const { db, tx } = makeDb({
                stores: [{ id: 'a', name: 'Dhaka', code: 'S1' }, { id: 'b', name: 'Ctg', code: null }],
            });
            const service = new DocumentNumberingService(db, audit as any);

            await service.update(CTX, 'SALE', { ...valid, template: '{STORE}-{FY}-{SEQ}', scope: 'STORE' });

            expect(tx.stores.find((s: any) => s.id === 'b').code).toBe('S2');
        });

        it('moves a counter forward for a shop continuing from another system', async () => {
            const { db, tx } = makeDb({ sequences: [{ period_key: '2627', scope_key: '', next_number: 5 }] });
            const service = new DocumentNumberingService(db, audit as any);

            await service.update(CTX, 'SALE', { ...valid, nextNumbers: [{ scopeKey: '', nextNumber: 1848 }] });

            expect(tx.sequences).toEqual([{ period_key: '2627', scope_key: '', next_number: 1848 }]);
        });

        it('starts a counter at the chosen number in the new format\'s period', async () => {
            const { db, tx } = makeDb();
            const service = new DocumentNumberingService(db, audit as any);

            await service.update(CTX, 'SALE', {
                template: '{YY}{MM}-{SEQ}',
                resetPolicy: 'MONTHLY',
                scope: 'TENANT',
                seqWidth: 3,
                nextNumbers: [{ scopeKey: '', nextNumber: 43 }],
            });

            expect(tx.sequences).toEqual([{ period_key: 'M2026-10', scope_key: '', next_number: 43 }]);
        });

        it('never moves a counter backward', async () => {
            const { db } = makeDb({ sequences: [{ period_key: '2627', scope_key: '', next_number: 50 }] });
            const service = new DocumentNumberingService(db, audit as any);

            await expect(service.update(CTX, 'SALE', { ...valid, nextNumbers: [{ scopeKey: '', nextNumber: 10 }] }))
                .rejects.toThrow(/cannot go back below 50/);
        });

        it('refuses to overwrite a number issued while the owner was editing', async () => {
            const { db, tx } = makeDb({ sequences: [{ period_key: '2627', scope_key: '', next_number: 50 }] });
            const service = new DocumentNumberingService(db, audit as any);
            // A sale takes 50 and 51 between the page's read and the save.
            tx.documentSequence.findUnique.mockResolvedValueOnce({ next_number: 50 });
            tx.sequences[0].next_number = 52;

            await expect(service.update(CTX, 'SALE', { ...valid, nextNumbers: [{ scopeKey: '', nextNumber: 51 }] }))
                .rejects.toThrow(ConflictException);
            expect(tx.sequences[0].next_number).toBe(52);
        });

        it('ignores a counter left where it is', async () => {
            const { db, tx } = makeDb({ sequences: [{ period_key: '2627', scope_key: '', next_number: 50 }] });
            const service = new DocumentNumberingService(db, audit as any);

            await service.update(CTX, 'SALE', { ...valid, nextNumbers: [{ scopeKey: '', nextNumber: 50 }] });

            expect(tx.documentSequence.updateMany).not.toHaveBeenCalled();
        });

        it('refuses a counter that is not part of the chosen series', async () => {
            const { db } = makeDb({
                counters: [{ id: 'till-1', store_id: 'store-1', name: 'Front', counter_number: 1 }],
            });
            const service = new DocumentNumberingService(db, audit as any);
            const perBranch = { ...valid, template: '{STORE}-{FY}-{SEQ}', scope: 'STORE' as const };

            await expect(service.update(CTX, 'SALE', { ...perBranch, nextNumbers: [{ scopeKey: '', nextNumber: 9 }] }))
                .rejects.toThrow(/does not belong to the chosen series/);
            await expect(service.update(CTX, 'SALE', { ...perBranch, nextNumbers: [{ scopeKey: 'store:elsewhere', nextNumber: 9 }] }))
                .rejects.toThrow(/does not belong to the chosen series/);
            await expect(service.update(CTX, 'SALE', { ...perBranch, nextNumbers: [{ scopeKey: 'store:store-1', nextNumber: 9 }] }))
                .resolves.toBeDefined();

            const perCounter = { ...valid, template: '{STORE}{COUNTER}-{FY}-{SEQ}', scope: 'COUNTER' as const };
            await expect(service.update(CTX, 'SALE', {
                ...perCounter,
                nextNumbers: [
                    { scopeKey: 'counter:till-1', nextNumber: 3 },
                    { scopeKey: 'store:store-1:none', nextNumber: 4 },
                ],
            })).resolves.toBeDefined();
        });
    });
});
