import {
    escapeLikePattern,
    FilterableMap,
    parseColumnFiltersParam,
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
