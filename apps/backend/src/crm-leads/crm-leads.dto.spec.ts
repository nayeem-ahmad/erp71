import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListLeadsDto, UpdateLeadDto } from './crm-leads.dto';

/**
 * The lead edit form used to POST the next-step rollup columns. Those keys
 * were dropped from UpdateLeadDto in R1 (they are written only by
 * CrmActivitiesService.recalculateRollup), and the global pipe runs with
 * `forbidNonWhitelisted`. Sending them is a 400 on the whole save — editing
 * any other field on a lead that already has a next step failed.
 *
 * These run the real pipe configuration from main.ts rather than validating
 * the class directly, so the test fails the same way production did.
 */
describe('UpdateLeadDto', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metadata = { type: 'body' as const, metatype: UpdateLeadDto };

    it('accepts a typical edit payload without next_step fields', async () => {
        const payload = {
            name: 'Karim Traders',
            status: 'CONTACTED',
            priority: 'MEDIUM',
            source: 'src-1',
            category: '',
        };

        await expect(pipe.transform(payload, metadata)).resolves.toEqual(
            expect.objectContaining({ name: 'Karim Traders', status: 'CONTACTED' }),
        );
    });

    it('turns a blank owner into an explicit null, so a lead can be unassigned', async () => {
        const result: any = await pipe.transform({ name: 'Karim Traders', assigned_to: '' }, metadata);
        expect(result.assigned_to).toBeNull();
    });

    it('still rejects a malformed owner id', async () => {
        await expect(
            pipe.transform({ name: 'Karim Traders', assigned_to: 'not-a-uuid' }, metadata),
        ).rejects.toThrow(BadRequestException);
    });

    it('turns a blank address into an explicit null rather than storing an empty string', async () => {
        const result: any = await pipe.transform({ name: 'Karim Traders', address: '' }, metadata);
        expect(result.address).toBeNull();
    });

    it('rejects next_step keys the edit form used to send', async () => {
        await expect(
            pipe.transform(
                {
                    name: 'Karim Traders',
                    next_step: 'Call back Thursday',
                    next_step_date: '2026-09-01T10:00:00.000Z',
                    next_step_assigned_to: 'user-9',
                },
                metadata,
            ),
        ).rejects.toThrow(BadRequestException);
    });
});

/**
 * Query params arrive as strings, and the leads list sends every filter it has
 * on every request — including the ones sitting at their "no filter" default.
 */
describe('ListLeadsDto — emailPresence', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metadata = { type: 'query' as const, metatype: ListLeadsDto };

    it('accepts the two presence values', async () => {
        await expect(pipe.transform({ emailPresence: 'empty' }, metadata)).resolves.toEqual(
            expect.objectContaining({ emailPresence: 'empty' }),
        );
        await expect(pipe.transform({ emailPresence: 'has' }, metadata)).resolves.toEqual(
            expect.objectContaining({ emailPresence: 'has' }),
        );
    });

    it('treats the unset filter as no filter rather than a 400', async () => {
        const result: any = await pipe.transform({ emailPresence: '' }, metadata);
        expect(result.emailPresence).toBeUndefined();
    });

    it('rejects a value outside the two, so a stale bookmark 400s instead of 500ing', async () => {
        await expect(
            pipe.transform({ emailPresence: 'maybe' }, metadata),
        ).rejects.toThrow(BadRequestException);
    });
});
