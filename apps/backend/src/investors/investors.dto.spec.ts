import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListProfitRunsQueryDto } from './investors.dto';

const validate = (payload: Record<string, unknown>) => {
    const dto = plainToInstance(ListProfitRunsQueryDto, payload);
    return { dto, errors: validateSync(dto as object).map((e) => e.property) };
};

/**
 * `year` is a query param, so it arrives as text and needs its own
 * `@Type(() => Number)` — the inherited ones on PaginationDto only cover
 * `page` and `limit`.
 */
describe('ListProfitRunsQueryDto', () => {
    it('accepts a year from the query string', () => {
        const { dto, errors } = validate({ year: '2026' });

        expect(errors).toEqual([]);
        expect(dto.year).toBe(2026);
    });

    it('still rejects a year outside the range', () => {
        expect(validate({ year: '1999' }).errors).toEqual(['year']);
    });

    it('still rejects a non-numeric year', () => {
        expect(validate({ year: 'last' }).errors).toEqual(['year']);
    });
});
