import { ValidationPipe } from '@nestjs/common';
import { CreateCrmActivityDto, SetActivityApprovalDto, UpdateCrmActivityDto } from './crm-activities.dto';

/**
 * When a logged activity happened. The pipe forbids unknown keys, so the field
 * has to be declared for the Log activity dialog's date to arrive at all.
 */
describe('CreateCrmActivityDto — completed_at', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metadata = { type: 'body' as const, metatype: CreateCrmActivityDto };

    it('accepts the bare wall clock a datetime-local input posts', async () => {
        const result: any = await pipe.transform({ completed_at: '2026-08-10T15:30' }, metadata);
        expect(result.completed_at).toBe('2026-08-10T15:30');
    });

    it('accepts one that names its offset', async () => {
        const result: any = await pipe.transform({ completed_at: '2026-08-10T15:30:00+06:00' }, metadata);
        expect(result.completed_at).toBe('2026-08-10T15:30:00+06:00');
    });

    it('drops an empty value, which means now', async () => {
        const result: any = await pipe.transform({ completed_at: '' }, metadata);
        expect(result.completed_at).toBeUndefined();
    });

    it('rejects something that is not a date', async () => {
        await expect(pipe.transform({ completed_at: 'last tuesday' }, metadata)).rejects.toThrow();
    });
});

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

/**
 * The switch posts a boolean and nothing else. A string "false" arriving as a
 * truthy value is the classic way a checkbox-shaped endpoint silently approves
 * what a reviewer just rejected, so the transform is asserted rather than assumed.
 */
describe('SetActivityApprovalDto', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metadata = { type: 'body' as const, metatype: SetActivityApprovalDto };

    it('accepts a real boolean', async () => {
        await expect(pipe.transform({ approved: true }, metadata)).resolves.toEqual({ approved: true });
        await expect(pipe.transform({ approved: false }, metadata)).resolves.toEqual({ approved: false });
    });

    it('reads the string "false" as false, not as a truthy string', async () => {
        const result: any = await pipe.transform({ approved: 'false' }, metadata);
        expect(result.approved).toBe(false);
    });

    it('rejects a missing approved flag', async () => {
        await expect(pipe.transform({}, metadata)).rejects.toThrow();
    });
});
