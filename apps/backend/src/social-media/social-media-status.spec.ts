import { canTransition, SocialPostStatus, SocialPushStatus, statusAfterPush } from './social-media-status';

describe('canTransition', () => {
    it('allows a draft to be scheduled or published', () => {
        expect(canTransition(SocialPostStatus.DRAFT, SocialPostStatus.SCHEDULED)).toBe(true);
        expect(canTransition(SocialPostStatus.DRAFT, SocialPostStatus.PUBLISHED)).toBe(true);
    });

    it('treats a no-op transition as allowed', () => {
        expect(canTransition(SocialPostStatus.PUBLISHED, SocialPostStatus.PUBLISHED)).toBe(true);
    });

    it('refuses to move a published post back — it is already in Buffer', () => {
        expect(canTransition(SocialPostStatus.PUBLISHED, SocialPostStatus.DRAFT)).toBe(false);
        expect(canTransition(SocialPostStatus.PUBLISHED, SocialPostStatus.SCHEDULED)).toBe(false);
    });

    it('lets a failed post be fixed and retried', () => {
        expect(canTransition(SocialPostStatus.FAILED, SocialPostStatus.DRAFT)).toBe(true);
        expect(canTransition(SocialPostStatus.FAILED, SocialPostStatus.SCHEDULED)).toBe(true);
    });

    it('rejects an unknown source status rather than defaulting to permissive', () => {
        expect(canTransition('NONSENSE', SocialPostStatus.PUBLISHED)).toBe(false);
    });
});

describe('statusAfterPush', () => {
    const now = new Date('2026-08-08T10:00:00.000Z');
    const future = new Date('2026-08-09T10:00:00.000Z');
    const past = new Date('2026-08-07T10:00:00.000Z');

    it('is FAILED when every channel rejected the post', () => {
        const status = statusAfterPush(
            [
                { status: SocialPushStatus.FAILED, due_at: null },
                { status: SocialPushStatus.FAILED, due_at: null },
            ],
            now,
        );
        expect(status).toBe(SocialPostStatus.FAILED);
    });

    it('is FAILED when nothing was pushed at all', () => {
        expect(statusAfterPush([], now)).toBe(SocialPostStatus.FAILED);
    });

    it('is PUBLISHED when a queued post has no date Buffer will honour later', () => {
        const status = statusAfterPush([{ status: SocialPushStatus.SENT, due_at: null }], now);
        expect(status).toBe(SocialPostStatus.PUBLISHED);
    });

    it('is SCHEDULED when everything that went out is dated in the future', () => {
        const status = statusAfterPush(
            [
                { status: SocialPushStatus.SENT, due_at: future },
                { status: SocialPushStatus.SENT, due_at: future },
            ],
            now,
        );
        expect(status).toBe(SocialPostStatus.SCHEDULED);
    });

    it('counts a partial success as published rather than hiding it as a failure', () => {
        const status = statusAfterPush(
            [
                { status: SocialPushStatus.SENT, due_at: past },
                { status: SocialPushStatus.FAILED, due_at: null },
            ],
            now,
        );
        expect(status).toBe(SocialPostStatus.PUBLISHED);
    });

    it('ignores the due date of a channel that failed', () => {
        // The failed row carries a future date; only the sent one should decide.
        const status = statusAfterPush(
            [
                { status: SocialPushStatus.SENT, due_at: null },
                { status: SocialPushStatus.FAILED, due_at: future },
            ],
            now,
        );
        expect(status).toBe(SocialPostStatus.PUBLISHED);
    });
});
