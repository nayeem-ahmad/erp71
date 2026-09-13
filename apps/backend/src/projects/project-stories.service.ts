import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import {
    CreateUserStoryDto,
    ListUserStoriesDto,
    UpdateUserStoryDto,
} from './project.dto';

/** What a story shows beside its title wherever it is listed. */
const STORY_INCLUDE = {
    project: { select: { id: true, code: true, name: true, short_name: true } },
    creator: { select: { id: true, name: true, email: true } },
} as const;

/**
 * How many times `create` retries after two concurrent stories pick the same
 * per-project reference. Same shape and the same reasoning as
 * `ProjectsService.nextCode`: a collision is rare, and a second attempt is
 * cheaper than serialising every create behind a lock.
 */
const REFERENCE_ATTEMPTS = 5;

/**
 * User stories — the requirements a project is being asked for, with the tasks
 * that deliver them hanging off them.
 *
 * A story holds no work of its own. Its progress is counted from its tasks on
 * every read rather than stored, for the reason `ProjectsService.progress`
 * gives: a stored copy drifts the moment a card moves and nobody recalculates
 * it. Its `status` is the *grooming* state somebody sets by hand (is this ready
 * to be picked up, has it been accepted) and is deliberately not derived from
 * those counts — a story whose tasks are all done is still not accepted until
 * someone says so, which is the whole point of acceptance criteria.
 *
 * Visibility comes from the project, like everything else in this module: a
 * story on a private project is invisible to anyone who cannot open the project
 * itself, and reports as missing rather than forbidden.
 */
@Injectable()
export class ProjectStoriesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
    ) {}

    async list(viewer: ProjectViewer, query: ListUserStoriesDto) {
        const tenantId = viewer.tenantId;
        if (query.projectId) await this.access.assertProjectVisible(viewer, query.projectId);

        const base: Record<string, unknown> = {
            tenant_id: tenantId,
            ...(query.projectId ? { project_id: query.projectId } : {}),
            ...(query.status ? { status: query.status } : {}),
            // A soft-deleted project keeps its rows; its stories must not keep
            // showing up in a cross-project list.
            project: { deleted_at: null },
        };

        const search = query.search?.trim();
        if (search) {
            base.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { i_want: { contains: search, mode: 'insensitive' } },
            ];
        }

        // Merged rather than spread: the search above already owns `OR`, and the
        // visibility filter contributes another.
        const where = ProjectAccessService.merge(base, await this.access.relatedFilter(viewer));

        const stories = await this.db.projectUserStory.findMany({
            where: where as never,
            orderBy: [{ sort_order: 'asc' }, { reference: 'asc' }],
            include: STORY_INCLUDE,
        });

        return this.withProgress(tenantId, stories as StoryRow[], viewer);
    }

    /** One story, with the tasks under it. */
    async findOne(viewer: ProjectViewer, storyId: string) {
        const story = await this.assertStory(viewer, storyId);
        const tasks = await this.db.projectTask.findMany({
            where: ProjectAccessService.merge(
                { tenant_id: viewer.tenantId, user_story_id: storyId, deleted_at: null },
                await this.access.taskFilter(viewer),
            ) as never,
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
            include: {
                status: { select: { id: true, name: true, category: true } },
                assignee: { select: { id: true, name: true, email: true } },
                assigneeEmployee: { select: { id: true, name: true } },
            },
        });

        const [withProgress] = await this.withProgress(viewer.tenantId, [story], viewer);
        return { ...withProgress, tasks };
    }

    async create(viewer: ProjectViewer, dto: CreateUserStoryDto) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, dto.projectId);

        const sortOrder = dto.sortOrder ?? (await this.nextSortOrder(tenantId, dto.projectId));

        for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
            try {
                return await this.db.projectUserStory.create({
                    data: {
                        tenant_id: tenantId,
                        project_id: dto.projectId,
                        reference: await this.nextReference(dto.projectId),
                        title: dto.title.trim(),
                        as_a: dto.asA?.trim() || null,
                        i_want: dto.iWant?.trim() || null,
                        so_that: dto.soThat?.trim() || null,
                        acceptance_criteria: dto.acceptanceCriteria?.trim() || null,
                        status: (dto.status ?? 'BACKLOG') as never,
                        priority: (dto.priority ?? 'MEDIUM') as never,
                        story_points: dto.storyPoints ?? null,
                        sort_order: sortOrder,
                        created_by: viewer.userId,
                    },
                    include: STORY_INCLUDE,
                });
            } catch (error: unknown) {
                const code = (error as { code?: string })?.code;
                if (code !== 'P2002' || attempt === REFERENCE_ATTEMPTS - 1) throw error;
            }
        }
        throw new BadRequestException('Could not allocate a story reference.');
    }

    async update(viewer: ProjectViewer, storyId: string, dto: UpdateUserStoryDto) {
        await this.assertStory(viewer, storyId);

        return this.db.projectUserStory.update({
            where: { id: storyId },
            data: {
                ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
                ...(dto.asA !== undefined ? { as_a: dto.asA?.trim() || null } : {}),
                ...(dto.iWant !== undefined ? { i_want: dto.iWant?.trim() || null } : {}),
                ...(dto.soThat !== undefined ? { so_that: dto.soThat?.trim() || null } : {}),
                ...(dto.acceptanceCriteria !== undefined
                    ? { acceptance_criteria: dto.acceptanceCriteria?.trim() || null }
                    : {}),
                ...(dto.status !== undefined ? { status: dto.status as never } : {}),
                ...(dto.priority !== undefined ? { priority: dto.priority as never } : {}),
                ...(dto.storyPoints !== undefined ? { story_points: dto.storyPoints ?? null } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
            include: STORY_INCLUDE,
        });
    }

    /**
     * Deleting a story detaches its tasks rather than taking them with it —
     * the same call `removeMilestone` makes, for the same reason: the story was
     * a grouping, the tasks are the work, and the hours logged against them are
     * a record of an afternoon somebody actually spent.
     */
    async remove(viewer: ProjectViewer, storyId: string) {
        const story = await this.assertStory(viewer, storyId);
        await this.db.$transaction([
            this.db.projectTask.updateMany({
                where: { tenant_id: viewer.tenantId, user_story_id: storyId },
                data: { user_story_id: null },
            }),
            this.db.projectUserStory.delete({ where: { id: story.id } }),
        ]);
        return { success: true };
    }

    /**
     * Task counts per story, in one query for the whole list.
     *
     * The obvious implementation — a count per story — is an N+1 that grows
     * with the backlog. Prisma cannot `groupBy` a relation's field, so this
     * reads the id and status category of the tasks under these stories and
     * folds them in memory, which is the same trade `ProjectsService.progress`
     * makes for a project's milestones.
     *
     * Scoped through `taskFilter`, so a narrow viewer's counts never include
     * rows the task list would not show them.
     */
    private async withProgress(tenantId: string, stories: StoryRow[], viewer: ProjectViewer) {
        if (stories.length === 0) return [];

        const tasks = await this.db.projectTask.findMany({
            where: ProjectAccessService.merge(
                {
                    tenant_id: tenantId,
                    user_story_id: { in: stories.map((story) => story.id) },
                    deleted_at: null,
                },
                await this.access.taskFilter(viewer),
            ) as never,
            select: { user_story_id: true, status: { select: { category: true } } },
        });

        const counts = new Map<string, { total: number; done: number }>();
        for (const task of tasks) {
            const key = task.user_story_id;
            if (!key) continue;
            const entry = counts.get(key) ?? { total: 0, done: 0 };
            entry.total += 1;
            if (task.status?.category === 'DONE') entry.done += 1;
            counts.set(key, entry);
        }

        return stories.map((story) => {
            const entry = counts.get(story.id) ?? { total: 0, done: 0 };
            return {
                ...story,
                progress: {
                    taskCount: entry.total,
                    doneTaskCount: entry.done,
                    percentComplete:
                        entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100),
                },
            };
        });
    }

    /** New stories land at the bottom of the project's backlog. */
    private async nextSortOrder(tenantId: string, projectId: string): Promise<number> {
        const last = await this.db.projectUserStory.findFirst({
            where: { tenant_id: tenantId, project_id: projectId },
            orderBy: { sort_order: 'desc' },
            select: { sort_order: true },
        });
        return (last?.sort_order ?? -1) + 1;
    }

    /**
     * `US-1`, `US-2`, … within one project. Taken from the highest reference
     * rather than a count so deleting US-2 does not hand its number to the next
     * story written — two different stories called US-2 in one backlog would
     * make every older note about it wrong.
     */
    private async nextReference(projectId: string): Promise<number> {
        const last = await this.db.projectUserStory.findFirst({
            where: { project_id: projectId },
            orderBy: { reference: 'desc' },
            select: { reference: true },
        });
        return (last?.reference ?? 0) + 1;
    }

    /**
     * Exists, is in this tenant, and hangs off a project this viewer can open.
     * One check rather than three, so a story on a private project is
     * indistinguishable from one that was never there.
     */
    async assertStory(viewer: ProjectViewer, storyId: string) {
        const story = await this.db.projectUserStory.findFirst({
            where: {
                id: storyId,
                tenant_id: viewer.tenantId,
                project: { deleted_at: null },
                ...(await this.access.relatedFilter(viewer)),
            } as never,
            include: STORY_INCLUDE,
        });
        if (!story) throw new NotFoundException('User story not found');
        return story as StoryRow;
    }
}

/** The part of a story row the rollup needs; the rest rides along untouched. */
interface StoryRow {
    id: string;
    [key: string]: unknown;
}
