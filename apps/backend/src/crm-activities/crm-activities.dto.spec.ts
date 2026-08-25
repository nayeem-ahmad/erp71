import { ValidationPipe } from '@nestjs/common';
import { UpdateCrmActivityDto } from './crm-activities.dto';

/**
 * Reassigning a planned activity is how a lead's `next_step_assigned_to` rollup
 * moves, and handing one back to nobody has to be reachable from that same form.
 *
 * `emptyToUndefined` made that impossible: '' became `undefined`, `update()`
 * skips undefined keys, and the old assignee silently survived a deliberate
 * clear. Same defect `address`/`assigned_to` had on the lead DTOs, same fix.
 *
 * Runs the real pipe configuration from main.ts rather than validating the class
 * directly, so it fails the way production would.
 */
describe('UpdateCrmActivityDto', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metadata = { type: 'body' as const, metatype: UpdateCrmActivityDto };

    it('keeps an empty assignee as an explicit null, so the clear reaches the column', async () => {
        const result: any = await pipe.transform({ assigned_to: '' }, metadata);
        expect(result.assigned_to).toBeNull();
    });

    it('passes a real assignee through untouched', async () => {
        const id = '11111111-1111-4111-8111-111111111111';
        const result: any = await pipe.transform({ assigned_to: id }, metadata);
        expect(result.assigned_to).toBe(id);
    });

    it('still rejects a non-uuid assignee', async () => {
        await expect(pipe.transform({ assigned_to: 'not-a-uuid' }, metadata)).rejects.toThrow();
    });

    it('leaves the key absent when it is not sent, so an unrelated edit keeps the assignee', async () => {
        const result: any = await pipe.transform({ subject: 'Chase it' }, metadata);
        expect(result).not.toHaveProperty('assigned_to');
    });
});
