import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateLeadDto } from './crm-leads.dto';

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
