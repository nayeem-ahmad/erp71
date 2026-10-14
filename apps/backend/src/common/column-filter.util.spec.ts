import { BadRequestException } from '@nestjs/common';
import {
    applyColumnFilters,
    codesContaining,
    escapeLikePattern,
    FilterableMap,
    NO_MATCH,
    numberEquals,
    parseColumnFiltersParam,
    parseNumberFilter,
    readColumnFiltersQuery,
    resolveColumnFilters,
} from './column-filter.util';

const filterable: FilterableMap<Record<string, unknown>> = {
    name: (value) => ({ name: { contains: value } }),
    cf_cf_1: (value) => ({ custom: value }),
};

describe('resolveColumnFilters', () => {
    it('turns each allowlisted filter into its clause', () => {
        expect(resolveColumnFilters({ name: 'karim', cf_cf_1: 'A' }, filterable)).toEqual([
            { name: { contains: 'karim' } },
            { custom: 'A' },
        ]);
    });

    it('drops a column the endpoint does not list', () => {
        expect(resolveColumnFilters({ password: 'x', name: 'karim' }, filterable)).toEqual([
            { name: { contains: 'karim' } },
        ]);
    });

    it('does not reach inherited keys', () => {
        expect(resolveColumnFilters({ constructor: 'x', toString: 'y' }, filterable)).toEqual([]);
    });

    it('trims the value and treats a blank one as no filter', () => {
        expect(resolveColumnFilters({ name: '  karim ', cf_cf_1: '   ' }, filterable)).toEqual([
            { name: { contains: 'karim' } },
        ]);
    });

    it('returns nothing when no filters are sent', () => {
        expect(resolveColumnFilters(undefined, filterable)).toEqual([]);
    });
});

describe('parseColumnFiltersParam', () => {
    it('parses the JSON object the table sends', () => {
        expect(parseColumnFiltersParam({ value: '{"cf_cf_1":"A"}' })).toEqual({ cf_cf_1: 'A' });
    });

    it('accepts an object the query parser already built', () => {
        expect(parseColumnFiltersParam({ value: { name: 'karim' } })).toEqual({ name: 'karim' });
    });

    it('treats an empty param as no filters', () => {
        expect(parseColumnFiltersParam({ value: '' })).toBeUndefined();
        expect(parseColumnFiltersParam({ value: undefined })).toBeUndefined();
    });

    it('hands anything else back unparsed, for the validator to reject', () => {
        for (const value of ['not json', '["a"]', '"a"', '{"score":5}', '{"a":{"b":"c"}}']) {
            expect(parseColumnFiltersParam({ value })).toBe(value);
        }
    });
});

describe('escapeLikePattern', () => {
    it('escapes the LIKE wildcards and the escape character', () => {
        expect(escapeLikePattern('50%_off\\')).toBe('50\\%\\_off\\\\');
    });

    it('leaves ordinary text alone', () => {
        expect(escapeLikePattern('Gold tier')).toBe('Gold tier');
    });
});

describe('readColumnFiltersQuery', () => {
    it('parses the param a raw @Query handler receives', () => {
        expect(readColumnFiltersQuery('{"name":"karim"}')).toEqual({ name: 'karim' });
        expect(readColumnFiltersQuery(undefined)).toBeUndefined();
        expect(readColumnFiltersQuery('')).toBeUndefined();
    });

    it('400s on anything that is not a flat object of strings', () => {
        for (const raw of ['not json', '["a"]', '{"a":1}', { a: { b: 'c' } }]) {
            expect(() => readColumnFiltersQuery(raw)).toThrow(BadRequestException);
        }
    });
});

describe('applyColumnFilters', () => {
    const map: FilterableMap<unknown> = { name: (v) => ({ name: v }) };

    it('appends to an AND the where already holds, as an array or a lone clause', () => {
        expect(applyColumnFilters({ AND: [{ a: 1 }] }, { name: 'x' }, map)).toEqual({ AND: [{ a: 1 }, { name: 'x' }] });
        expect(applyColumnFilters({ AND: { a: 1 } }, { name: 'x' }, map)).toEqual({ AND: [{ a: 1 }, { name: 'x' }] });
    });

    it('leaves the where alone, OR included, when nothing applies', () => {
        const where = { OR: [{ b: 2 }] };
        expect(applyColumnFilters(where, undefined, map)).toBe(where);
        expect(applyColumnFilters(where, { other: 'x' }, map)).toBe(where);
        expect(applyColumnFilters(where, { name: 'x' }, map)).toEqual({ OR: [{ b: 2 }], AND: [{ name: 'x' }] });
    });
});

describe('codesContaining', () => {
    const codes = ['MANUAL', 'BUSINESS_CARD', 'IMPORT'] as const;

    it('matches codes ignoring case, reading an underscore as a space', () => {
        expect(codesContaining(codes, 'business card')).toEqual(['BUSINESS_CARD']);
        expect(codesContaining(codes, 'card')).toEqual(['BUSINESS_CARD']);
        expect(codesContaining(codes, 'man')).toEqual(['MANUAL']);
        expect(codesContaining(codes, 'nothing')).toEqual([]);
    });
});

describe('numberEquals', () => {
    it('reads a typed amount, separators and the taka sign included', () => {
        expect(parseNumberFilter('৳1,250.50')).toBe(1250.5);
        expect(parseNumberFilter('-3')).toBe(-3);
        expect(parseNumberFilter('12abc')).toBeNull();
    });

    it('matches the column exactly, and nothing for text that is not a number', () => {
        expect(numberEquals('total_amount')('500')).toEqual({ total_amount: 500 });
        expect(numberEquals('total_amount')('five')).toBe(NO_MATCH);
    });
});
