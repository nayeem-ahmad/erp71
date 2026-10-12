import type { SyncWarning } from './external-sync.mapper';
import {
    MAX_STORED_WARNINGS,
    capWarnings,
    countWarningCodes,
    describeWriteError,
    freeDocumentNumber,
    partyLabel,
} from './skipped-records';

function note(i: number): SyncWarning {
    return { entity: 'SALE', externalId: String(i), code: 'QUANTITY_ROUNDED', message: `note ${i}` };
}

function skip(i: number): SyncWarning {
    return {
        entity: 'QUOTATION',
        externalId: `q${i}`,
        code: 'WRITE_FAILED',
        message: `skip ${i}`,
        skipped: { number: `XR-${i}`, date: '2026-10-01', party: null, amount: 100, lines: 1 },
    };
}

describe('capWarnings', () => {
    it('keeps every skipped record even when ordinary notes fill the cap first', () => {
        const warnings = [...Array.from({ length: 600 }, (_, i) => note(i)), skip(1), skip(2)];
        const kept = capWarnings(warnings);

        expect(kept.filter((w) => w.skipped).map((w) => w.externalId)).toEqual(['q1', 'q2']);
        expect(kept).toHaveLength(MAX_STORED_WARNINGS);
        // Notes keep their order, so the first ones raised are the ones kept.
        expect(kept.filter((w) => !w.skipped)[0].message).toBe('note 0');
    });

    it('leaves a list under the cap alone', () => {
        const warnings = [note(1), skip(1)];
        expect(capWarnings(warnings)).toEqual([skip(1), note(1)]);
    });
});

describe('countWarningCodes', () => {
    it('counts every warning, not just the stored ones', () => {
        const warnings = [...Array.from({ length: 600 }, (_, i) => note(i)), skip(1)];
        expect(countWarningCodes(warnings)).toEqual({ QUANTITY_ROUNDED: 600, WRITE_FAILED: 1 });
    });
});

describe('describeWriteError', () => {
    it('names the clashing fields of a unique violation', () => {
        const error = Object.assign(new Error('\nInvalid `prisma.quotation.create()` invocation:\n\nUnique constraint failed on the fields: (`tenant_id`,`quote_number`,`version`)'), {
            code: 'P2002',
            meta: { target: ['tenant_id', 'quote_number', 'version'] },
        });
        expect(describeWriteError(error)).toBe('another record already has the same quote_number, version');
    });

    it('keeps only the line that says what went wrong', () => {
        const error = new Error('\nInvalid `tx.inventoryMovement.create()` invocation in\n/app/src/x.ts:12:3\n\nInventory movement delta cannot be zero.');
        expect(describeWriteError(error)).toBe('Inventory movement delta cannot be zero.');
    });

    it('copes with a thrown string', () => {
        expect(describeWriteError('boom')).toBe('boom');
    });
});

describe('freeDocumentNumber', () => {
    it('keeps a free number as it is', async () => {
        expect(await freeDocumentNumber('XR-2500028', async () => false)).toBe('XR-2500028');
    });

    it('suffixes a taken number with the first free -2, -3, …', async () => {
        const taken = new Set(['XR-2500028', 'XR-2500028-2']);
        expect(await freeDocumentNumber('XR-2500028', async (n) => taken.has(n))).toBe('XR-2500028-3');
    });
});

describe('partyLabel', () => {
    it('reads the code and name off an embedded party', () => {
        expect(partyLabel('48078', { id: 48078, code: 'C00203', name: 'Some Pharmacy' })).toBe('C00203 Some Pharmacy');
    });

    it('falls back to the provider id', () => {
        expect(partyLabel('48078', null)).toBe('#48078');
        expect(partyLabel(null, null)).toBeNull();
    });
});
