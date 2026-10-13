import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListLoansQueryDto } from './loans.dto';

/**
 * `GET /loans` binds its query to this DTO under the global pipe's
 * `forbidNonWhitelisted`, so a filter key the DTO does not declare is a 400 for
 * the whole list, not an ignored extra.
 */
describe('ListLoansQueryDto', () => {
    const parse = (payload: unknown) =>
        validate(plainToInstance(ListLoansQueryDto, payload), {
            whitelist: true,
            forbidNonWhitelisted: true,
        });

    it('accepts a start-date window next to the created one', async () => {
        expect(
            await parse({ dateFrom: '2026-08-12', dateTo: '2026-08-19', createdFrom: '2026-08-01', createdTo: '2026-08-31' }),
        ).toHaveLength(0);
    });

    it('refuses a start-date bound that is not a date', async () => {
        expect(await parse({ dateFrom: 'last week' })).not.toHaveLength(0);
    });
});
