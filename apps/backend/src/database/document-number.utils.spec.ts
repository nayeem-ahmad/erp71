import {
    fiscalYearKey,
    issueDocumentNumber,
    loadNumberingConfig,
    nextDocumentNumber,
    numberingScopeKey,
    tenantCalendarMonth,
    DocumentSeries,
} from './document-number.utils';

describe('fiscalYearKey', () => {
    // Constructed with local-time components on purpose: the function reads the
    // local calendar, so a `new Date('2025-07-01')` (parsed as UTC midnight)
    // would be the previous day — and the previous fiscal year — west of GMT.
    const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);

    it('starts a new year in July', () => {
        expect(fiscalYearKey(local(2025, 6, 30))).toBe('2425');
        expect(fiscalYearKey(local(2025, 7, 1))).toBe('2526');
    });

    it('keeps January to June on the year that started the previous July', () => {
        expect(fiscalYearKey(local(2026, 1, 15))).toBe('2526');
        expect(fiscalYearKey(local(2026, 6, 30))).toBe('2526');
        expect(fiscalYearKey(local(2026, 7, 1))).toBe('2627');
    });

    it('pads a single-digit year', () => {
        expect(fiscalYearKey(local(2009, 8, 1))).toBe('0910');
    });

    it('handles the century roll', () => {
        expect(fiscalYearKey(local(2099, 8, 1))).toBe('9900');
    });
});

describe('nextDocumentNumber', () => {
    const makeTx = (afterIncrement: number) => ({
        documentSequence: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockResolvedValue({ next_number: afterIncrement }),
        },
    });

    it('returns the number it reserved, not the incremented one', async () => {
        const tx = makeTx(2);

        const number = await nextDocumentNumber(tx as any, {
            tenantId: 't1',
            series: DocumentSeries.PROFORMA,
            on: new Date(2025, 8, 10),
        });

        expect(number).toBe('PI-2526-00001');
    });

    it('pads to five digits and keeps counting past them', async () => {
        expect(
            await nextDocumentNumber(makeTx(43) as any, {
                tenantId: 't1',
                series: DocumentSeries.QUOTE,
                on: new Date(2025, 8, 10),
            }),
        ).toBe('QT-2526-00042');

        expect(
            await nextDocumentNumber(makeTx(100001) as any, {
                tenantId: 't1',
                series: DocumentSeries.QUOTE,
                on: new Date(2025, 8, 10),
            }),
        ).toBe('QT-2526-100000');
    });

    it('keys the counter by series and fiscal year', async () => {
        const tx = makeTx(2);

        await nextDocumentNumber(tx as any, {
            tenantId: 't1',
            series: DocumentSeries.IMPORT_SHIPMENT,
            on: new Date(2026, 2, 1),
        });

        expect(tx.documentSequence.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({
                tenant_id: 't1',
                doc_type: 'IMPORT_SHIPMENT',
                period_key: '2526',
                // The built-in series are business-wide.
                scope_key: '',
                prefix: 'IMP',
            })],
            // Never a read-then-insert: see reserveSequenceNumber.
            skipDuplicates: true,
        });
    });

    it('omits the period segment for a series that never resets', async () => {
        const number = await nextDocumentNumber(makeTx(8) as any, {
            tenantId: 't1',
            series: DocumentSeries.QUOTE,
            resetsYearly: false,
        });

        expect(number).toBe('QT-00007');
    });
});

/**
 * A transaction that keeps document_sequences in memory, so these tests watch
 * counters actually advance instead of asserting on mocked return values.
 */
function makeNumberingTx(options: {
    numbering?: { template: string; reset_policy: string; scope: string; seq_width: number } | null;
    timezone?: string | null;
    stores?: { id: string; code: string | null }[];
    counters?: { id: string; counter_number: number }[];
} = {}) {
    const sequences = new Map<string, number>();
    const keyOf = (where: any) => {
        const k = where.tenant_id_doc_type_period_key_scope_key;
        return [k.tenant_id, k.doc_type, k.period_key, k.scope_key].join('|');
    };
    const stores = (options.stores ?? [{ id: 'store-1', code: 'S1' }]).map((s) => ({ ...s, tenant_id: 't1' }));
    const counters = (options.counters ?? []).map((c) => ({ ...c, tenant_id: 't1' }));

    const tx = {
        sequences,
        documentNumbering: {
            findUnique: jest.fn().mockResolvedValue(options.numbering ?? null),
        },
        tenant: {
            findUnique: jest.fn().mockResolvedValue({ timezone: options.timezone ?? 'Asia/Dhaka' }),
        },
        store: {
            findFirst: jest.fn(async ({ where }: any) => stores.find((s) => s.id === where.id && s.tenant_id === where.tenant_id) ?? null),
            findMany: jest.fn(async () => stores.filter((s) => s.code)),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const store = stores.find((s) => s.id === where.id && s.code === null);
                if (store) store.code = data.code;
                return { count: store ? 1 : 0 };
            }),
        },
        posCounter: {
            findFirst: jest.fn(async ({ where }: any) => counters.find((c) => c.id === where.id && c.tenant_id === where.tenant_id) ?? null),
        },
        documentSequence: {
            createMany: jest.fn(async ({ data }: any) => {
                const row = data[0];
                const key = [row.tenant_id, row.doc_type, row.period_key, row.scope_key].join('|');
                if (sequences.has(key)) return { count: 0 };
                sequences.set(key, row.next_number);
                return { count: 1 };
            }),
            update: jest.fn(async ({ where, data }: any) => {
                const key = keyOf(where);
                const next = (sequences.get(key) ?? 1) + data.next_number.increment;
                sequences.set(key, next);
                return { next_number: next };
            }),
        },
    };
    return tx;
}

describe('issueDocumentNumber', () => {
    // 10:00 on 7 October 2026 in Dhaka.
    const october = new Date('2026-10-07T04:00:00.000Z');

    it('issues the built-in default until the tenant saves a format', async () => {
        const tx = makeNumberingTx();

        const first = await issueDocumentNumber(tx as any, { tenantId: 't1', docType: 'SALE', storeId: 'store-1', on: october });
        const second = await issueDocumentNumber(tx as any, { tenantId: 't1', docType: 'SALE', storeId: 'store-1', on: october });

        expect([first, second]).toEqual(['INV-2627-00001', 'INV-2627-00002']);
        expect([...tx.sequences.keys()]).toEqual(['t1|SALE|2627|']);
    });

    it('reads the fiscal year in the tenant zone, not the UTC server clock', async () => {
        // 00:30 on 1 July in Dhaka is still 30 June in UTC.
        const tx = makeNumberingTx();

        const number = await issueDocumentNumber(tx as any, {
            tenantId: 't1',
            docType: 'SALE',
            storeId: 'store-1',
            on: new Date('2026-06-30T18:30:00.000Z'),
        });

        expect(number).toBe('INV-2627-00001');
    });

    it('runs a separate series per branch, printed with the branch code', async () => {
        const tx = makeNumberingTx({
            numbering: { template: '{STORE}-{FY}-{SEQ}', reset_policy: 'FISCAL_YEAR', scope: 'STORE', seq_width: 4 },
            stores: [{ id: 'dhaka', code: 'DHK' }, { id: 'ctg', code: 'CTG' }],
        });

        const issue = (storeId: string) =>
            issueDocumentNumber(tx as any, { tenantId: 't1', docType: 'SALE', storeId, on: october });

        expect(await issue('dhaka')).toBe('DHK-2627-0001');
        expect(await issue('dhaka')).toBe('DHK-2627-0002');
        expect(await issue('ctg')).toBe('CTG-2627-0001');
    });

    it('gives a branch with no code one before printing it', async () => {
        const tx = makeNumberingTx({
            numbering: { template: '{STORE}-{SEQ}', reset_policy: 'NEVER', scope: 'STORE', seq_width: 3 },
            stores: [{ id: 'old', code: 'S1' }, { id: 'new', code: null }],
        });

        const number = await issueDocumentNumber(tx as any, { tenantId: 't1', docType: 'SALE', storeId: 'new', on: october });

        expect(number).toBe('S2-001');
        expect(tx.store.updateMany).toHaveBeenCalledWith({
            where: { id: 'new', tenant_id: 't1', code: null },
            data: { code: 'S2' },
        });
    });

    it('runs a series per POS counter, and a separate one for sales on no counter', async () => {
        const tx = makeNumberingTx({
            numbering: { template: '{STORE}{COUNTER}-{SEQ}', reset_policy: 'NEVER', scope: 'COUNTER', seq_width: 3 },
            counters: [{ id: 'till-1', counter_number: 1 }, { id: 'till-2', counter_number: 2 }],
        });
        const issue = (counterId: string | null) =>
            issueDocumentNumber(tx as any, { tenantId: 't1', docType: 'SALE', storeId: 'store-1', counterId, on: october });

        expect(await issue('till-1')).toBe('S11-001');
        expect(await issue('till-2')).toBe('S12-001');
        expect(await issue('till-1')).toBe('S11-002');
        expect(await issue(null)).toBe('S10-001');
    });

    it('treats a counter from another tenant as no counter at all', async () => {
        const tx = makeNumberingTx({
            numbering: { template: '{STORE}{COUNTER}-{SEQ}', reset_policy: 'NEVER', scope: 'COUNTER', seq_width: 3 },
            counters: [],
        });

        const number = await issueDocumentNumber(tx as any, {
            tenantId: 't1', docType: 'SALE', storeId: 'store-1', counterId: 'someone-elses-till', on: october,
        });

        expect(number).toBe('S10-001');
        expect([...tx.sequences.keys()]).toEqual(['t1|SALE||store:store-1:none']);
    });

    it('restarts a monthly series each month', async () => {
        const tx = makeNumberingTx({
            numbering: { template: '{YY}{MM}-{SEQ}', reset_policy: 'MONTHLY', scope: 'TENANT', seq_width: 3 },
        });
        const issue = (on: Date) => issueDocumentNumber(tx as any, { tenantId: 't1', docType: 'SALE', storeId: 'store-1', on });

        expect(await issue(october)).toBe('2610-001');
        expect(await issue(october)).toBe('2610-002');
        expect(await issue(new Date('2026-11-01T04:00:00.000Z'))).toBe('2611-001');
    });

    it('steps over a number that is already in use', async () => {
        const tx = makeNumberingTx();
        const taken = new Set(['INV-2627-00001', 'INV-2627-00002']);

        const number = await issueDocumentNumber(tx as any, {
            tenantId: 't1', docType: 'SALE', storeId: 'store-1', on: october,
            isTaken: async (candidate) => taken.has(candidate),
        });

        expect(number).toBe('INV-2627-00003');
    });

    it('gives up loudly rather than looping forever', async () => {
        const tx = makeNumberingTx();

        await expect(issueDocumentNumber(tx as any, {
            tenantId: 't1', docType: 'SALE', storeId: 'store-1', on: october,
            isTaken: async () => true,
        })).rejects.toThrow(/Could not find an unused document number/);
    });
});

describe('numberingScopeKey', () => {
    it('keys each scope', () => {
        expect(numberingScopeKey('TENANT', { storeId: 's', counterId: 'c' })).toBe('');
        expect(numberingScopeKey('STORE', { storeId: 's', counterId: 'c' })).toBe('store:s');
        expect(numberingScopeKey('COUNTER', { storeId: 's', counterId: 'c' })).toBe('counter:c');
        expect(numberingScopeKey('COUNTER', { storeId: 's', counterId: null })).toBe('store:s:none');
    });
});

describe('loadNumberingConfig', () => {
    it('falls back to the default for an unrecognised policy in a hand-edited row', async () => {
        const tx = makeNumberingTx({
            numbering: { template: 'X-{SEQ}', reset_policy: 'WEEKLY', scope: 'GALAXY', seq_width: 3 },
        });

        const { config, isDefault } = await loadNumberingConfig(tx as any, 't1', 'SALE');

        expect(isDefault).toBe(false);
        expect(config).toEqual({ template: 'X-{SEQ}', resetPolicy: 'FISCAL_YEAR', scope: 'TENANT', seqWidth: 3 });
    });
});

describe('tenantCalendarMonth', () => {
    it('uses the tenant timezone, defaulting to Dhaka', async () => {
        const instant = new Date('2026-06-30T18:30:00.000Z');

        expect(await tenantCalendarMonth(makeNumberingTx({ timezone: null }) as any, 't1', instant))
            .toEqual({ year: 2026, month: 7 });
        expect(await tenantCalendarMonth(makeNumberingTx({ timezone: 'Europe/London' }) as any, 't1', instant))
            .toEqual({ year: 2026, month: 6 });
    });
});
