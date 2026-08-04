import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListCommissionsQueryDto, ListRefereesQueryDto, RecordPaymentDto } from './referrals.dto';

/**
 * `referee_id` and `status` are interpolated straight into a Prisma `where`, so
 * anything that gets past validation reaches the database driver. An unknown
 * status used to be accepted as a bare string and surfaced as a 500 from Prisma
 * rather than a 400 from the pipe — the same failure shape that `ListLeadsDto`
 * was introduced to fix on the CRM side.
 *
 * These run the real pipe configuration from main.ts rather than validating the
 * classes directly, so a regression fails the way production would.
 */
describe('referrals DTO validation', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const uuid = '3f1a9c4e-1b2d-4c3a-8e5f-6a7b8c9d0e1f';

    describe('ListCommissionsQueryDto', () => {
        const metadata = { type: 'query' as const, metatype: ListCommissionsQueryDto };

        it.each(['PENDING', 'EARNED', 'PAID'])('accepts the %s status', async (status) => {
            await expect(pipe.transform({ status }, metadata)).resolves.toEqual({ status });
        });

        it('rejects an unknown status instead of passing it to Prisma', async () => {
            await expect(pipe.transform({ status: 'garbage' }, metadata)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('rejects a lower-case status rather than silently matching nothing', async () => {
            await expect(pipe.transform({ status: 'pending' }, metadata)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('accepts a well-formed referee_id', async () => {
            await expect(pipe.transform({ referee_id: uuid }, metadata)).resolves.toEqual({
                referee_id: uuid,
            });
        });

        it('rejects a referee_id that is not a uuid', async () => {
            await expect(pipe.transform({ referee_id: 'not-an-id' }, metadata)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('treats an empty query value as absent, so a cleared filter still works', async () => {
            await expect(pipe.transform({ status: '', referee_id: '' }, metadata)).resolves.toEqual({});
        });

        it('accepts an empty query', async () => {
            await expect(pipe.transform({}, metadata)).resolves.toEqual({});
        });

        it('coerces the page window out of query strings', async () => {
            await expect(pipe.transform({ limit: '25', offset: '50' }, metadata)).resolves.toEqual({
                limit: 25,
                offset: 50,
            });
        });

        it('rejects a non-numeric limit rather than falling back to a default', async () => {
            await expect(pipe.transform({ limit: 'abc' }, metadata)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('rejects a page size beyond the cap', async () => {
            await expect(pipe.transform({ limit: '500' }, metadata)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('rejects a negative offset', async () => {
            await expect(pipe.transform({ offset: '-1' }, metadata)).rejects.toThrow(
                BadRequestException,
            );
        });
    });

    describe('ListRefereesQueryDto', () => {
        const metadata = { type: 'query' as const, metatype: ListRefereesQueryDto };

        it.each([
            ['true', true],
            ['1', true],
            ['false', false],
            ['0', false],
        ])('coerces include_archived=%s', async (input, expected) => {
            await expect(pipe.transform({ include_archived: input }, metadata)).resolves.toEqual({
                include_archived: expected,
            });
        });

        it('treats an absent flag as absent rather than false', async () => {
            await expect(pipe.transform({}, metadata)).resolves.toEqual({});
        });

        it('rejects a value that is neither boolean nor a recognised string', async () => {
            await expect(
                pipe.transform({ include_archived: 'maybe' }, metadata),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('RecordPaymentDto', () => {
        const metadata = { type: 'body' as const, metatype: RecordPaymentDto };

        it('accepts a payout with explicit commission ids', async () => {
            await expect(
                pipe.transform({ amount: 500, commission_ids: [uuid] }, metadata),
            ).resolves.toEqual(expect.objectContaining({ amount: 500, commission_ids: [uuid] }));
        });

        it('accepts a payout with no ids, which clears every earned commission', async () => {
            await expect(pipe.transform({ amount: 500 }, metadata)).resolves.toEqual(
                expect.objectContaining({ amount: 500 }),
            );
        });

        it('accepts a payout with no amount, which settles exactly what is owed', async () => {
            await expect(pipe.transform({}, metadata)).resolves.toEqual({});
        });

        it('accepts an explicit part-payment', async () => {
            await expect(
                pipe.transform({ amount: 100, allow_partial: true }, metadata),
            ).resolves.toEqual(expect.objectContaining({ amount: 100, allow_partial: true }));
        });

        it('rejects a non-boolean allow_partial', async () => {
            await expect(
                pipe.transform({ amount: 100, allow_partial: 'yes' }, metadata),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects commission ids that are not uuids', async () => {
            await expect(
                pipe.transform({ amount: 500, commission_ids: ['nope'] }, metadata),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects a bare string where an array of ids is expected', async () => {
            await expect(
                pipe.transform({ amount: 500, commission_ids: uuid }, metadata),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects a zero or negative payout amount', async () => {
            await expect(pipe.transform({ amount: 0 }, metadata)).rejects.toThrow(BadRequestException);
            await expect(pipe.transform({ amount: -1 }, metadata)).rejects.toThrow(BadRequestException);
        });
    });
});
