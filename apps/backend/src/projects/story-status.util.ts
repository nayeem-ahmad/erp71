import { BadRequestException } from '@nestjs/common';

export type StoryStatus = 'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'DONE';
export type TaskCategory = 'TODO' | 'IN_PROGRESS' | 'DONE';

/**
 * A story's status, read off the tasks that deliver it.
 *
 * Once a story has tasks, how far along it is is a fact about those tasks, not
 * something to be kept in step by hand — a story left at READY while half its
 * tasks are done is simply wrong. So:
 *
 * - every task DONE → DONE
 * - any task started or finished (but not all finished) → IN_PROGRESS
 * - every task still TODO → the grooming state somebody set (BACKLOG or READY);
 *   a story that had moved on and whose work was all reopened falls back to READY
 *
 * A story with no tasks keeps whatever it was given: there is nothing to derive
 * from, and BACKLOG → READY is exactly the grooming call a person makes.
 */
export function deriveStoryStatus(current: StoryStatus, categories: TaskCategory[]): StoryStatus {
    if (categories.length === 0) return current;
    const done = categories.filter((category) => category === 'DONE').length;
    if (done === categories.length) return 'DONE';
    if (done > 0 || categories.includes('IN_PROGRESS')) return 'IN_PROGRESS';
    return current === 'BACKLOG' || current === 'READY' ? current : 'READY';
}

/**
 * Refuses a hand-set status the story's tasks contradict. BACKLOG ↔ READY
 * stays settable while no task has started, because that is the one part of
 * the status the tasks do not decide.
 */
export function assertStoryStatusAllowed(requested: StoryStatus, categories: TaskCategory[]) {
    const derived = deriveStoryStatus(requested, categories);
    if (derived !== requested) {
        throw new BadRequestException(
            `This story's status follows its tasks and is currently ${derived.replace('_', ' ').toLowerCase()}.`,
        );
    }
}

interface StoryStatusDb {
    projectTask: {
        findMany(args: unknown): Promise<{ user_story_id: string | null; status: { category: string } | null }[]>;
    };
    projectUserStory: {
        findMany(args: unknown): Promise<{ id: string; status: string }[]>;
        update(args: unknown): Promise<unknown>;
    };
}

/**
 * Brings the stored status of these stories in line with their tasks, writing
 * only the ones that changed. Called after anything that can change which tasks
 * a story has or what column they sit in.
 *
 * Reads every live task, not the viewer's slice of them: the status is one
 * value everybody sees, so it cannot depend on who happened to move the card.
 */
export async function syncStoryStatuses(
    db: StoryStatusDb,
    tenantId: string,
    storyIds: (string | null | undefined)[],
): Promise<void> {
    const ids = [...new Set(storyIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return;

    const [stories, tasks] = await Promise.all([
        db.projectUserStory.findMany({
            where: { tenant_id: tenantId, id: { in: ids } },
            select: { id: true, status: true },
        }),
        db.projectTask.findMany({
            where: { tenant_id: tenantId, user_story_id: { in: ids }, deleted_at: null },
            select: { user_story_id: true, status: { select: { category: true } } },
        }),
    ]);

    const categories = new Map<string, TaskCategory[]>();
    for (const task of tasks) {
        if (!task.user_story_id || !task.status) continue;
        const list = categories.get(task.user_story_id) ?? [];
        list.push(task.status.category as TaskCategory);
        categories.set(task.user_story_id, list);
    }

    for (const story of stories) {
        const next = deriveStoryStatus(story.status as StoryStatus, categories.get(story.id) ?? []);
        if (next !== story.status) {
            await db.projectUserStory.update({ where: { id: story.id }, data: { status: next } });
        }
    }
}
