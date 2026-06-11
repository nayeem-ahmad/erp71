/**
 * Tests for src/lib/compound-units.ts
 *
 * Covers: COMPOUND_UNIT_DEFS constants, isCompoundUnit, toCompoundParts,
 * fromCompoundParts, formatCompoundQty.
 */

import {
    COMPOUND_UNIT_DEFS,
    isCompoundUnit,
    toCompoundParts,
    fromCompoundParts,
    formatCompoundQty,
    type CompoundUnitType,
} from './compound-units';

// ===========================================================================
// COMPOUND_UNIT_DEFS — validate the constant data
// ===========================================================================

describe('COMPOUND_UNIT_DEFS', () => {
    it('defines all six unit types', () => {
        const keys = Object.keys(COMPOUND_UNIT_DEFS);
        expect(keys).toEqual(expect.arrayContaining(['none', 'ft_in', 'dozen_pcs', 'kg_g', 'lb_oz', 'm_cm']));
        expect(keys).toHaveLength(6);
    });

    it('none has secondaryPerPrimary of 1', () => {
        expect(COMPOUND_UNIT_DEFS.none.secondaryPerPrimary).toBe(1);
        expect(COMPOUND_UNIT_DEFS.none.secondaryUnit).toBe('');
    });

    it('ft_in has 12 inches per foot', () => {
        expect(COMPOUND_UNIT_DEFS.ft_in.secondaryPerPrimary).toBe(12);
        expect(COMPOUND_UNIT_DEFS.ft_in.primaryUnit).toBe('ft');
        expect(COMPOUND_UNIT_DEFS.ft_in.secondaryUnit).toBe('in');
    });

    it('dozen_pcs has 12 pieces per dozen', () => {
        expect(COMPOUND_UNIT_DEFS.dozen_pcs.secondaryPerPrimary).toBe(12);
        expect(COMPOUND_UNIT_DEFS.dozen_pcs.primaryUnit).toBe('doz');
        expect(COMPOUND_UNIT_DEFS.dozen_pcs.secondaryUnit).toBe('pcs');
    });

    it('kg_g has 1000 grams per kilogram', () => {
        expect(COMPOUND_UNIT_DEFS.kg_g.secondaryPerPrimary).toBe(1000);
        expect(COMPOUND_UNIT_DEFS.kg_g.primaryUnit).toBe('kg');
        expect(COMPOUND_UNIT_DEFS.kg_g.secondaryUnit).toBe('g');
    });

    it('lb_oz has 16 ounces per pound', () => {
        expect(COMPOUND_UNIT_DEFS.lb_oz.secondaryPerPrimary).toBe(16);
        expect(COMPOUND_UNIT_DEFS.lb_oz.primaryUnit).toBe('lb');
        expect(COMPOUND_UNIT_DEFS.lb_oz.secondaryUnit).toBe('oz');
    });

    it('m_cm has 100 centimeters per meter', () => {
        expect(COMPOUND_UNIT_DEFS.m_cm.secondaryPerPrimary).toBe(100);
        expect(COMPOUND_UNIT_DEFS.m_cm.primaryUnit).toBe('m');
        expect(COMPOUND_UNIT_DEFS.m_cm.secondaryUnit).toBe('cm');
    });

    it('each entry has a non-empty label', () => {
        for (const def of Object.values(COMPOUND_UNIT_DEFS)) {
            expect(typeof def.label).toBe('string');
            expect(def.label.length).toBeGreaterThan(0);
        }
    });
});

// ===========================================================================
// isCompoundUnit
// ===========================================================================

describe('isCompoundUnit', () => {
    it('returns false for "none"', () => {
        expect(isCompoundUnit('none')).toBe(false);
    });

    it('returns true for valid compound types', () => {
        const valid: string[] = ['ft_in', 'dozen_pcs', 'kg_g', 'lb_oz', 'm_cm'];
        for (const t of valid) {
            expect(isCompoundUnit(t)).toBe(true);
        }
    });

    it('returns false for unknown strings', () => {
        expect(isCompoundUnit('pcs')).toBe(false);
        expect(isCompoundUnit('')).toBe(false);
        expect(isCompoundUnit('UNKNOWN')).toBe(false);
    });
});

// ===========================================================================
// toCompoundParts
// ===========================================================================

describe('toCompoundParts', () => {
    // ft_in: 12 inches per foot
    describe('ft_in', () => {
        it('splits exactly on a foot boundary', () => {
            expect(toCompoundParts(24, 'ft_in')).toEqual({ primary: 2, secondary: 0 });
        });

        it('splits with remainder inches', () => {
            expect(toCompoundParts(17, 'ft_in')).toEqual({ primary: 1, secondary: 5 });
        });

        it('handles zero', () => {
            expect(toCompoundParts(0, 'ft_in')).toEqual({ primary: 0, secondary: 0 });
        });

        it('handles value less than one primary unit', () => {
            expect(toCompoundParts(7, 'ft_in')).toEqual({ primary: 0, secondary: 7 });
        });
    });

    // kg_g: 1000 grams per kg
    describe('kg_g', () => {
        it('splits 1500g into 1kg 500g', () => {
            expect(toCompoundParts(1500, 'kg_g')).toEqual({ primary: 1, secondary: 500 });
        });

        it('splits exactly 2000g into 2kg 0g', () => {
            expect(toCompoundParts(2000, 'kg_g')).toEqual({ primary: 2, secondary: 0 });
        });

        it('handles fractional base (rounding secondary)', () => {
            // 1000.6 -> primary=1, secondary=round(0.6)=1
            expect(toCompoundParts(1000.6, 'kg_g')).toEqual({ primary: 1, secondary: 1 });
        });
    });

    // lb_oz: 16 ounces per pound
    describe('lb_oz', () => {
        it('splits 18 oz into 1lb 2oz', () => {
            expect(toCompoundParts(18, 'lb_oz')).toEqual({ primary: 1, secondary: 2 });
        });

        it('splits 32oz into 2lb 0oz', () => {
            expect(toCompoundParts(32, 'lb_oz')).toEqual({ primary: 2, secondary: 0 });
        });
    });

    // dozen_pcs: 12 pcs per dozen
    describe('dozen_pcs', () => {
        it('splits 25 pieces into 2 dozen 1 pcs', () => {
            expect(toCompoundParts(25, 'dozen_pcs')).toEqual({ primary: 2, secondary: 1 });
        });
    });

    // m_cm: 100 cm per meter
    describe('m_cm', () => {
        it('splits 250cm into 2m 50cm', () => {
            expect(toCompoundParts(250, 'm_cm')).toEqual({ primary: 2, secondary: 50 });
        });
    });
});

// ===========================================================================
// fromCompoundParts
// ===========================================================================

describe('fromCompoundParts', () => {
    // ft_in
    describe('ft_in', () => {
        it('converts 2ft 0in to 24', () => {
            expect(fromCompoundParts(2, 0, 'ft_in')).toBe(24);
        });

        it('converts 1ft 5in to 17', () => {
            expect(fromCompoundParts(1, 5, 'ft_in')).toBe(17);
        });

        it('converts 0ft 7in to 7', () => {
            expect(fromCompoundParts(0, 7, 'ft_in')).toBe(7);
        });

        it('converts 0ft 0in to 0', () => {
            expect(fromCompoundParts(0, 0, 'ft_in')).toBe(0);
        });
    });

    // kg_g
    describe('kg_g', () => {
        it('converts 1kg 500g to 1500', () => {
            expect(fromCompoundParts(1, 500, 'kg_g')).toBe(1500);
        });

        it('converts 0kg 250g to 250', () => {
            expect(fromCompoundParts(0, 250, 'kg_g')).toBe(250);
        });
    });

    // lb_oz
    describe('lb_oz', () => {
        it('converts 1lb 2oz to 18', () => {
            expect(fromCompoundParts(1, 2, 'lb_oz')).toBe(18);
        });
    });

    // dozen_pcs
    describe('dozen_pcs', () => {
        it('converts 2doz 1pcs to 25', () => {
            expect(fromCompoundParts(2, 1, 'dozen_pcs')).toBe(25);
        });
    });

    // m_cm
    describe('m_cm', () => {
        it('converts 2m 50cm to 250', () => {
            expect(fromCompoundParts(2, 50, 'm_cm')).toBe(250);
        });
    });

    // round-trip
    describe('round-trip', () => {
        const cases: [number, CompoundUnitType][] = [
            [17, 'ft_in'],
            [1500, 'kg_g'],
            [18, 'lb_oz'],
            [25, 'dozen_pcs'],
            [250, 'm_cm'],
        ];

        it.each(cases)('round-trip: fromCompoundParts(toCompoundParts(%d, %s)) === %d', (base, type) => {
            const { primary, secondary } = toCompoundParts(base, type);
            expect(fromCompoundParts(primary, secondary, type)).toBe(base);
        });
    });
});

// ===========================================================================
// formatCompoundQty
// ===========================================================================

describe('formatCompoundQty', () => {
    it('returns String(baseValue) for "none" unit type', () => {
        expect(formatCompoundQty(5, 'none')).toBe('5');
        expect(formatCompoundQty(0, 'none')).toBe('0');
        expect(formatCompoundQty(100, 'none')).toBe('100');
    });

    it('returns String(baseValue) for unknown unit types', () => {
        expect(formatCompoundQty(10, 'pcs')).toBe('10');
        expect(formatCompoundQty(3, '')).toBe('3');
        expect(formatCompoundQty(7, 'unknown_type')).toBe('7');
    });

    describe('ft_in', () => {
        it('formats 24 as "2 ft" (no secondary when 0)', () => {
            expect(formatCompoundQty(24, 'ft_in')).toBe('2 ft');
        });

        it('formats 17 as "1 ft 5 in"', () => {
            expect(formatCompoundQty(17, 'ft_in')).toBe('1 ft 5 in');
        });

        it('formats 7 as "0 ft 7 in"', () => {
            expect(formatCompoundQty(7, 'ft_in')).toBe('0 ft 7 in');
        });

        it('formats 0 as "0 ft"', () => {
            expect(formatCompoundQty(0, 'ft_in')).toBe('0 ft');
        });
    });

    describe('kg_g', () => {
        it('formats 2000 as "2 kg"', () => {
            expect(formatCompoundQty(2000, 'kg_g')).toBe('2 kg');
        });

        it('formats 1500 as "1 kg 500 g"', () => {
            expect(formatCompoundQty(1500, 'kg_g')).toBe('1 kg 500 g');
        });

        it('formats 250 as "0 kg 250 g"', () => {
            expect(formatCompoundQty(250, 'kg_g')).toBe('0 kg 250 g');
        });
    });

    describe('lb_oz', () => {
        it('formats 32 as "2 lb"', () => {
            expect(formatCompoundQty(32, 'lb_oz')).toBe('2 lb');
        });

        it('formats 18 as "1 lb 2 oz"', () => {
            expect(formatCompoundQty(18, 'lb_oz')).toBe('1 lb 2 oz');
        });
    });

    describe('dozen_pcs', () => {
        it('formats 24 as "2 doz"', () => {
            expect(formatCompoundQty(24, 'dozen_pcs')).toBe('2 doz');
        });

        it('formats 25 as "2 doz 1 pcs"', () => {
            expect(formatCompoundQty(25, 'dozen_pcs')).toBe('2 doz 1 pcs');
        });
    });

    describe('m_cm', () => {
        it('formats 300 as "3 m"', () => {
            expect(formatCompoundQty(300, 'm_cm')).toBe('3 m');
        });

        it('formats 250 as "2 m 50 cm"', () => {
            expect(formatCompoundQty(250, 'm_cm')).toBe('2 m 50 cm');
        });
    });
});
