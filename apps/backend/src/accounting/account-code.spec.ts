import {
    AccountCodeExhaustedError,
    accountCodePrefix,
    decodeSerial,
    encodeSerial,
    formatAccountCode,
    maxSerial,
    nextAccountCode,
    nextGroupCode,
    nextSerial,
    nextSubgroupCode,
    normalizeAccountCode,
    parseAccountCode,
    validateAccountCode,
} from '@erp71/database';

/**
 * The chart-of-accounts code scheme. The load-bearing property is that a plain
 * string sort equals hierarchy order, which only holds while every segment stays
 * fixed width — hence the base-36 spill rather than a wider field.
 */
describe('account code serials', () => {
    it('encodes the decimal phase zero-padded', () => {
        expect(encodeSerial(1, 2)).toBe('01');
        expect(encodeSerial(9, 2)).toBe('09');
        expect(encodeSerial(99, 2)).toBe('99');
        expect(encodeSerial(1, 1)).toBe('1');
        expect(encodeSerial(9, 1)).toBe('9');
    });

    it('spills into base-36 at the same width once decimal runs out', () => {
        expect(encodeSerial(100, 2)).toBe('A0');
        expect(encodeSerial(109, 2)).toBe('A9');
        expect(encodeSerial(110, 2)).toBe('AA');
        expect(encodeSerial(135, 2)).toBe('AZ');
        expect(encodeSerial(136, 2)).toBe('B0');
        expect(encodeSerial(1035, 2)).toBe('ZZ');

        expect(encodeSerial(10, 1)).toBe('A');
        expect(encodeSerial(35, 1)).toBe('Z');
    });

    it('never widens the code when it spills', () => {
        for (let serial = 1; serial <= maxSerial(2); serial += 1) {
            expect(encodeSerial(serial, 2)).toHaveLength(2);
        }
        for (let serial = 1; serial <= maxSerial(1); serial += 1) {
            expect(encodeSerial(serial, 1)).toHaveLength(1);
        }
    });

    /**
     * The reason the spill is safe: '9' (0x39) sorts before 'A' (0x41), so the
     * encoded sequence stays in ascending lexicographic order across the seam.
     */
    it('keeps lexicographic order equal to numeric order across the whole range', () => {
        const encoded = Array.from({ length: maxSerial(2) }, (_, i) => encodeSerial(i + 1, 2));
        const sorted = [...encoded].sort();
        expect(sorted).toEqual(encoded);
    });

    it('round-trips through decodeSerial', () => {
        for (let serial = 1; serial <= maxSerial(2); serial += 1) {
            expect(decodeSerial(encodeSerial(serial, 2), 2)).toBe(serial);
        }
        for (let serial = 1; serial <= maxSerial(1); serial += 1) {
            expect(decodeSerial(encodeSerial(serial, 1), 1)).toBe(serial);
        }
    });

    it('rejects shapes the scheme never emits', () => {
        expect(decodeSerial('0A', 2)).toBeNull(); // alpha phase always opens with a letter
        expect(decodeSerial('00', 2)).toBeNull(); // reserved slot, not a serial
        expect(decodeSerial('a0', 2)).toBeNull(); // lowercase would sort after 'Z'
        expect(decodeSerial('1', 2)).toBeNull(); // wrong width
        expect(decodeSerial('A-', 2)).toBeNull();
    });

    it('refuses to encode past the end of the range', () => {
        expect(() => encodeSerial(maxSerial(2) + 1, 2)).toThrow(AccountCodeExhaustedError);
        expect(() => encodeSerial(maxSerial(1) + 1, 1)).toThrow(AccountCodeExhaustedError);
    });
});

describe('serial allocation', () => {
    it('is monotonic so a deleted account\'s code is not recycled', () => {
        // 2 was deleted; the next account must still be 4, not 2 — last year's
        // printed ledger has to keep meaning what it said.
        expect(nextSerial([1, 3], 2)).toBe(4);
    });

    it('backfills holes only once the decimal phase is full', () => {
        const full = Array.from({ length: 99 }, (_, i) => i + 1);
        expect(nextSerial(full, 2)).toBe(100); // no holes left, so spill

        const withHole = full.filter((n) => n !== 42);
        expect(nextSerial(withHole, 2)).toBe(42); // reuse rather than go alpha
    });

    it('does not push everything into letters because of one hand-picked high code', () => {
        // Someone typed …90 by hand. max+1 stays decimal, so nothing spills.
        expect(nextSerial([1, 2, 90], 2)).toBe(91);
    });

    it('throws once every slot under the parent is taken', () => {
        const everything = Array.from({ length: maxSerial(2) }, (_, i) => i + 1);
        expect(() => nextSerial(everything, 2)).toThrow(AccountCodeExhaustedError);
    });
});

describe('code composition', () => {
    it('opens a group code with its type digit', () => {
        expect(nextGroupCode('asset', [])).toBe('11');
        expect(nextGroupCode('liability', [])).toBe('21');
        expect(nextGroupCode('equity', [])).toBe('31');
        expect(nextGroupCode('revenue', [])).toBe('41');
        expect(nextGroupCode('expense', [])).toBe('51');
    });

    it('counts only siblings of the same type', () => {
        expect(nextGroupCode('asset', ['11', '12', '21', '51'])).toBe('13');
    });

    it('prefixes subgroups with the group and accounts with the subgroup', () => {
        expect(nextSubgroupCode('11', ['1101', '1102'])).toBe('1103');
        expect(nextAccountCode('11', '1101', ['110101'])).toBe('110102');
    });

    it('parks accounts with no subgroup in the reserved 00 slot', () => {
        expect(accountCodePrefix('11', null)).toBe('1100');
        expect(nextAccountCode('11', null, [])).toBe('110001');
    });

    it('ignores codes belonging to a different parent when allocating', () => {
        expect(nextAccountCode('11', '1101', ['110201', '110202', '110101'])).toBe('110102');
    });

    it('spills an over-full subgroup into letters without widening', () => {
        const siblings = Array.from({ length: 99 }, (_, i) =>
            '1101' + String(i + 1).padStart(2, '0'),
        );
        const next = nextAccountCode('11', '1101', siblings);
        expect(next).toBe('1101A0');
        expect(next).toHaveLength(6);
        expect(next > siblings[98]).toBe(true); // still sorts after 110199
    });
});

describe('validation', () => {
    it('accepts a well-formed code under its parent', () => {
        expect(validateAccountCode('11', 'group', '1')).toBeNull();
        expect(validateAccountCode('1101', 'subgroup', '11')).toBeNull();
        expect(validateAccountCode('110101', 'account', '1101')).toBeNull();
        expect(validateAccountCode('1101A0', 'account', '1101')).toBeNull();
    });

    it('rejects a code that does not sit under its parent', () => {
        expect(validateAccountCode('1201', 'subgroup', '11')).toMatch(/must start with/);
        expect(validateAccountCode('110201', 'account', '1101')).toMatch(/must start with/);
    });

    it('rejects a group code whose digit contradicts its type', () => {
        expect(validateAccountCode('51', 'group', '1')).toMatch(/account type/);
    });

    it('rejects wrong widths, stray characters and the reserved serial', () => {
        expect(validateAccountCode('1101', 'account', '1101')).toMatch(/exactly 6/);
        expect(validateAccountCode('1101-1', 'account', '1101')).toMatch(/digits and capital/);
        expect(validateAccountCode('110100', 'account', '1101')).toMatch(/serial/);
    });

    it('uppercases input so it cannot sort below the decimal phase', () => {
        expect(normalizeAccountCode(' 1101a0 ')).toBe('1101A0');
    });
});

/**
 * account-code.ts and account-code.js are hand-maintained twins (the package
 * resolves to the .js at runtime). Drift between them would mean the seeds and
 * the API hand out different codes, so pin them together here.
 */
describe('the .ts and .js twins agree', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require('@erp71/database/prisma/account-code.ts');

    it('encodes and decodes identically across the whole 2-char range', () => {
        for (let serial = 1; serial <= maxSerial(2); serial += 1) {
            expect(ts.encodeSerial(serial, 2)).toBe(encodeSerial(serial, 2));
        }
        for (let serial = 1; serial <= maxSerial(1); serial += 1) {
            expect(ts.encodeSerial(serial, 1)).toBe(encodeSerial(serial, 1));
        }
    });

    it('validates identically', () => {
        const cases: Array<[string, 'group' | 'subgroup' | 'account', string | null]> = [
            ['11', 'group', '1'],
            ['51', 'group', '1'],
            ['1101', 'subgroup', '11'],
            ['1201', 'subgroup', '11'],
            ['110101', 'account', '1101'],
            ['110100', 'account', '1101'],
            ['1101-1', 'account', '1101'],
        ];
        for (const [code, level, parent] of cases) {
            expect(ts.validateAccountCode(code, level, parent)).toEqual(
                validateAccountCode(code, level, parent),
            );
        }
    });

    it('allocates identically', () => {
        expect(ts.nextGroupCode('asset', ['11', '12'])).toBe(nextGroupCode('asset', ['11', '12']));
        expect(ts.nextAccountCode('11', null, [])).toBe(nextAccountCode('11', null, []));
    });
});

describe('parsing and display', () => {
    it('splits a code into its segments', () => {
        expect(parseAccountCode('110101')).toEqual({
            typeDigit: '1',
            groupCode: '11',
            subgroupSlot: '01',
            subgroupCode: '1101',
            accountSerial: '01',
            hasSubgroup: true,
        });
    });

    it('flags the reserved slot as having no subgroup', () => {
        expect(parseAccountCode('110001')?.hasSubgroup).toBe(false);
    });

    it('formats for display without changing what is stored', () => {
        expect(formatAccountCode('110101')).toBe('11-01-01');
    });
});
