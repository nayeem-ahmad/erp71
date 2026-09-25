import { BadRequestException } from '@nestjs/common';
import { assertStoryStatusAllowed, deriveStoryStatus, syncStoryStatuses } from './story-status.util';

describe('deriveStoryStatus', () => {
    it('leaves a story with no tasks at whatever it was given', () => {
        expect(deriveStoryStatus('BACKLOG', [])).toBe('BACKLOG');
        expect(deriveStoryStatus('DONE', [])).toBe('DONE');
    });

    it('is DONE only when every task is done', () => {
        expect(deriveStoryStatus('READY', ['DONE', 'DONE'])).toBe('DONE');
        expect(deriveStoryStatus('READY', ['DONE', 'TODO'])).toBe('IN_PROGRESS');
    });

    it('is IN_PROGRESS as soon as any task has started', () => {
        expect(deriveStoryStatus('BACKLOG', ['TODO', 'IN_PROGRESS'])).toBe('IN_PROGRESS');
    });

    it('keeps the grooming state while nothing has started', () => {
        expect(deriveStoryStatus('BACKLOG', ['TODO'])).toBe('BACKLOG');
        expect(deriveStoryStatus('READY', ['TODO', 'TODO'])).toBe('READY');
    });

    it('falls back to READY when all its work is reopened', () => {
        expect(deriveStoryStatus('DONE', ['TODO'])).toBe('READY');
        expect(deriveStoryStatus('IN_PROGRESS', ['TODO'])).toBe('READY');
    });
});

describe('assertStoryStatusAllowed', () => {
    it('allows the grooming call while no task has started', () => {
        expect(() => assertStoryStatusAllowed('READY', ['TODO'])).not.toThrow();
        expect(() => assertStoryStatusAllowed('BACKLOG', ['TODO'])).not.toThrow();
    });

    it('refuses a status the tasks contradict', () => {
        expect(() => assertStoryStatusAllowed('DONE', ['TODO', 'DONE'])).toThrow(BadRequestException);
        expect(() => assertStoryStatusAllowed('READY', ['IN_PROGRESS'])).toThrow(BadRequestException);
    });

    it('allows anything on a story without tasks', () => {
        expect(() => assertStoryStatusAllowed('DONE', [])).not.toThrow();
    });
});

describe('syncStoryStatuses', () => {
    function mockDb(stories: { id: string; status: string }[], tasks: unknown[]) {
        return {
            projectUserStory: {
                findMany: jest.fn().mockResolvedValue(stories),
                update: jest.fn().mockResolvedValue({}),
            },
            projectTask: { findMany: jest.fn().mockResolvedValue(tasks) },
        };
    }

    it('writes only the stories whose status changed', async () => {
        const db = mockDb(
            [
                { id: 's1', status: 'READY' },
                { id: 's2', status: 'IN_PROGRESS' },
            ],
            [
                { user_story_id: 's1', status: { category: 'DONE' } },
                { user_story_id: 's2', status: { category: 'IN_PROGRESS' } },
            ],
        );
        await syncStoryStatuses(db, 't1', ['s1', 's2']);
        expect(db.projectUserStory.update).toHaveBeenCalledTimes(1);
        expect(db.projectUserStory.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'DONE' } });
    });

    it('does nothing, and reads nothing, without a story to sync', async () => {
        const db = mockDb([], []);
        await syncStoryStatuses(db, 't1', [null, undefined, '']);
        expect(db.projectUserStory.findMany).not.toHaveBeenCalled();
    });

    it('scopes both reads to the tenant and ignores deleted tasks', async () => {
        const db = mockDb([{ id: 's1', status: 'BACKLOG' }], []);
        await syncStoryStatuses(db, 't1', ['s1', 's1']);
        expect(db.projectTask.findMany.mock.calls[0][0].where).toEqual({
            tenant_id: 't1',
            user_story_id: { in: ['s1'] },
            deleted_at: null,
        });
        expect(db.projectUserStory.findMany.mock.calls[0][0].where).toEqual({ tenant_id: 't1', id: { in: ['s1'] } });
    });
});
