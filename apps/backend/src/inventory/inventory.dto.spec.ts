import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListStockLedgerQueryDto } from './inventory.dto';

const validate = (payload: Record<string, unknown>) => {
    const dto = plainToInstance(ListStockLedgerQueryDto, payload);
    return { dto, errors: validateSync(dto as object).map((e) => e.property) };
};

/**
 * A query string has no types: `?page=2&limit=25` arrives as the strings "2" and
 * "25". The global ValidationPipe runs with `transform: true` but not
 * `enableImplicitConversion`, so every numeric query field needs `@Type(() => Number)`
 * of its own. `limit` was missing it, and since the ledger page sends `limit` on
 * every single request, every request 400d and the table rendered "no history".
 */
describe('ListStockLedgerQueryDto', () => {
    it('accepts the page and limit the ledger page actually sends', () => {
        const { dto, errors } = validate({ page: '2', limit: '25' });

        expect(errors).toEqual([]);
        expect(dto.page).toBe(2);
        expect(dto.limit).toBe(25);
    });

    it('accepts every page size the table offers', () => {
        for (const size of [10, 20, 50, 100, 500]) {
            expect(validate({ limit: String(size) }).errors).toEqual([]);
        }
    });

    it('accepts a bare request with no pagination at all', () => {
        expect(validate({}).errors).toEqual([]);
    });

    it('still rejects a limit past the cap', () => {
        expect(validate({ limit: '501' }).errors).toEqual(['limit']);
    });

    it('still rejects a non-numeric limit', () => {
        expect(validate({ limit: 'all' }).errors).toEqual(['limit']);
    });

    it('accepts the filters alongside pagination', () => {
        const { errors } = validate({
            warehouseId: '11111111-1111-4111-8111-111111111111',
            movementType: 'SALE',
            page: '1',
            limit: '50',
            sortBy: 'created_at',
            sortDir: 'desc',
        });

        expect(errors).toEqual([]);
    });
});
