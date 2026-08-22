import { fiscalYearKey, nextDocumentNumber, DocumentSeries } from './document-number.utils';

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
            upsert: jest.fn().mockResolvedValue({}),
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

        expect(tx.documentSequence.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    tenant_id: 't1',
                    doc_type: 'IMPORT_SHIPMENT',
                    period_key: '2526',
                    prefix: 'IMP',
                }),
            }),
        );
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
