import { BadRequestException } from '@nestjs/common';
import { numberConditionFilter, readIdListQuery, readNumberConditionQuery } from './number-condition.util';

describe('readNumberConditionQuery', () => {
    it('reads each operator', () => {
        expect(readNumberConditionQuery('gt:1000', 'total')).toEqual({ op: 'gt', value: 1000 });
        expect(readNumberConditionQuery('lt:99.5', 'total')).toEqual({ op: 'lt', value: 99.5 });
        expect(readNumberConditionQuery('eq:0', 'total')).toEqual({ op: 'eq', value: 0 });
        expect(readNumberConditionQuery('between:500,2000', 'total')).toEqual({ op: 'between', value: 500, to: 2000 });
    });

    it('puts a between typed the wrong way round in order', () => {
        expect(readNumberConditionQuery('between:2000,500', 'total')).toEqual({ op: 'between', value: 500, to: 2000 });
    });

    it('treats a missing or blank param as no filter', () => {
        expect(readNumberConditionQuery(undefined, 'total')).toBeUndefined();
        expect(readNumberConditionQuery('', 'total')).toBeUndefined();
    });

    it.each(['1000', 'gte:5', 'gt:abc', 'gt:', 'between:5', 'between:1,2,3', 'gt:1,2'])(
        'refuses %p rather than ignoring it',
        (raw) => {
            expect(() => readNumberConditionQuery(raw, 'total')).toThrow(BadRequestException);
        },
    );
});

describe('numberConditionFilter', () => {
    it('maps each operator onto a Prisma filter, between taking both ends', () => {
        expect(numberConditionFilter({ op: 'gt', value: 5 })).toEqual({ gt: 5 });
        expect(numberConditionFilter({ op: 'lt', value: 5 })).toEqual({ lt: 5 });
        expect(numberConditionFilter({ op: 'eq', value: 5 })).toEqual({ equals: 5 });
        expect(numberConditionFilter({ op: 'between', value: 5, to: 9 })).toEqual({ gte: 5, lte: 9 });
    });
});

describe('readIdListQuery', () => {
    it('splits a comma list and drops blanks', () => {
        expect(readIdListQuery('a, b,,c ')).toEqual(['a', 'b', 'c']);
    });

    it('is undefined when nothing is left', () => {
        expect(readIdListQuery(' , ')).toBeUndefined();
        expect(readIdListQuery(undefined)).toBeUndefined();
    });
});
