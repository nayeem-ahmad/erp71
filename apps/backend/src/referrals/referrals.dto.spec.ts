import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListCommissionsQueryDto, RecordPaymentDto } from './referrals.dto';

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
