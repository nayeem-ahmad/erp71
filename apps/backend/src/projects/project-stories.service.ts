import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { runImport, type ImportResult } from '../common/import.util';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import {
    CreateUserStoryDto,
    ListUserStoriesDto,
    ProjectPriorityDto,
    UpdateUserStoryDto,
    UserStoryStatusDto,
} from './project.dto';
import {
    importEnum,
    importNumber,
    importText,
    lookup,
    nameIndex,
    requiredText,
} from './project-import.util';

/** What a story shows beside its title wherever it is listed. */
const STORY_INCLUDE = {
    project: { select: { id: true, code: true, name: true, short_name: true } },
    creator: { select: { id: true, name: true, email: true } },
    epic: { select: { id: true, code: true, title: true, color: true } },
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
            ...(query.priority ? { priority: query.priority } : {}),
            ...(query.epicId ? { epic_id: query.epicId } : {}),
            ...(query.noEpic === 'true' ? { epic_id: null } : {}),
            // A soft-deleted project keeps its rows; its stories must not keep
            // showing up in a cross-project list.
            project: { deleted_at: null },
        };

        const search = query.search?.trim();
        if (search) {
            base.OR = [
                { code: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
                { i_want: { contains: search, mode: 'insensitive' } },
            ];
        }

        // Merged rather than spread: the search above already owns `OR`, and the
        // visibility filter contributes another.
        const where = ProjectAccessService.merge(base, await this.access.relatedFilter(viewer));

        const stories = await this.db.projectUserStory.findMany({
            where: where as never,
            // Within one project, `sort_order` is the backlog order somebody
            // arranged and `reference` breaks the ties. Across projects that
            // pair is meaningless on its own — it interleaves every project's
            // US-1, then every project's US-2 — so the cross-project list is
            // grouped by project first and each project's backlog order is
            // preserved inside its group.
            orderBy: query.projectId
                ? [{ sort_order: 'asc' }, { reference: 'asc' }]
                : [{ project: { code: 'asc' } }, { sort_order: 'asc' }, { reference: 'asc' }],
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
        const typedCode = dto.code?.trim() || null;
        if (typedCode) await this.assertCodeFree(dto.projectId, typedCode);
        if (dto.epicId) await this.assertEpicInProject(tenantId, dto.epicId, dto.projectId);

        for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
            try {
                const reference = await this.nextReference(dto.projectId);
                return await this.db.projectUserStory.create({
                    data: {
                        tenant_id: tenantId,
                        project_id: dto.projectId,
                        reference,
                        code: typedCode ?? (await this.defaultCode(dto.projectId, reference)),
                        title: dto.title.trim(),
                        as_a: dto.asA?.trim() || null,
                        i_want: dto.iWant?.trim() || null,
                        so_that: dto.soThat?.trim() || null,
                        acceptance_criteria: dto.acceptanceCriteria?.trim() || null,
                        status: (dto.status ?? 'BACKLOG') as never,
                        priority: (dto.priority ?? 'MEDIUM') as never,
                        story_points: dto.storyPoints ?? null,
                        epic_id: dto.epicId || null,
                        sort_order: sortOrder,
                        created_by: viewer.userId,
                    },
                    include: STORY_INCLUDE,
                });
            } catch (error: unknown) {
                const code = (error as { code?: string })?.code;
                if (code !== 'P2002' || attempt === REFERENCE_ATTEMPTS - 1) throw error;
                // A typed ID that lost a race is the caller's clash to resolve,
                // not something another attempt will fix.
                if (typedCode) await this.assertCodeFree(dto.projectId, typedCode);
            }
        }
        throw new BadRequestException('Could not allocate a story reference.');
    }

    async update(viewer: ProjectViewer, storyId: string, dto: UpdateUserStoryDto) {
        const story = await this.assertStory(viewer, storyId);

        let code: string | undefined;
        if (dto.code !== undefined) {
            code = dto.code.trim();
            if (!code) throw new BadRequestException('Story ID cannot be empty');
            if (code !== story.code) await this.assertCodeFree(story.project_id as string, code, storyId);
        }
        if (dto.epicId) {
            await this.assertEpicInProject(viewer.tenantId, dto.epicId, story.project_id as string);
        }

        return this.db.projectUserStory.update({
            where: { id: storyId },
            data: {
                ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
                ...(code !== undefined ? { code } : {}),
                ...(dto.asA !== undefined ? { as_a: dto.asA?.trim() || null } : {}),
                ...(dto.iWant !== undefined ? { i_want: dto.iWant?.trim() || null } : {}),
                ...(dto.soThat !== undefined ? { so_that: dto.soThat?.trim() || null } : {}),
                ...(dto.acceptanceCriteria !== undefined
                    ? { acceptance_criteria: dto.acceptanceCriteria?.trim() || null }
                    : {}),
                ...(dto.status !== undefined ? { status: dto.status as never } : {}),
                ...(dto.priority !== undefined ? { priority: dto.priority as never } : {}),
                ...(dto.storyPoints !== undefined ? { story_points: dto.storyPoints ?? null } : {}),
                ...(dto.epicId !== undefined ? { epic_id: dto.epicId || null } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
            include: STORY_INCLUDE,
        });
    }

    /**
     * Stories from a spreadsheet — the backlog a team brings with them from
     * another tool. Project is named by code or name, like the task import.
     *
     * A row is matched to an existing story by its ID when the file carries
     * one, and by title within the project otherwise, so re-importing the same
     * file updates rather than duplicates. A row with an ID that does not exist
     * yet creates a story under that ID — which is how a team keeps the IDs
     * they already use.
     */
    async importRows(
        viewer: ProjectViewer,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        const tenantId = viewer.tenantId;
        const projects = await this.db.project.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                ...(await this.access.projectFilter(viewer)),
            } as never,
            select: { id: true, code: true, short_name: true, name: true },
        });
        const projectIndex = nameIndex(
            projects,
            (project) => [project.code, project.short_name, project.name],
            (project) => project.id,
        );
        // An epic is named by its ID or its title, and only means anything
        // within its own project — so the index is keyed per project.
        const epics = await this.db.projectEpic.findMany({
            where: { tenant_id: tenantId, project_id: { in: projects.map((project) => project.id) } },
            select: { id: true, project_id: true, code: true, title: true },
        });
        const epicIndex = new Map<string, Map<string, string>>();
        for (const project of projects) {
            epicIndex.set(
                project.id,
                nameIndex(
                    epics.filter((epic) => epic.project_id === project.id),
                    (epic) => [epic.code, epic.title],
                    (epic) => epic.id,
                ),
            );
        }

        return runImport<StoryImportRow>(rows, mode, tenantId, {
            requiredFields: ['project', 'title'],
            castRow: (raw) => {
                const code = importText(raw.code);
                if (code && /\s/.test(code)) throw new Error(`Story ID cannot contain spaces (got "${code}")`);
                if (code && code.length > 40) throw new Error('Story ID must be 40 characters or fewer');
                const points = importNumber(raw.storyPoints, 'Story points');
                if (points !== null && (!Number.isInteger(points) || points < 0 || points > 999)) {
                    throw new Error(`Story points must be a whole number from 0 to 999 (got "${points}")`);
                }
                const projectId = lookup(projectIndex, requiredText(raw.project, 'Project'), 'no project matches');
                const epicText = importText(raw.epic);
                return {
                    projectId,
                    epicId: epicText
                        ? lookup(epicIndex.get(projectId) ?? new Map(), epicText, 'no epic in that project matches')
                        : null,
                    code,
                    title: requiredText(raw.title, 'Title'),
                    asA: importText(raw.asA),
                    iWant: importText(raw.iWant),
                    soThat: importText(raw.soThat),
                    acceptanceCriteria: importText(raw.acceptanceCriteria),
                    status: importEnum(raw.status, Object.values(UserStoryStatusDto), 'Status'),
                    priority: importEnum(raw.priority, Object.values(ProjectPriorityDto), 'Priority'),
                    storyPoints: points,
                };
            },
            dedupeKeys: (row) =>
                row.code
                    ? [`code:${row.projectId}:${row.code.toLowerCase()}`]
                    : [`title:${row.projectId}:${row.title.toLowerCase()}`],
            describeDedupeKey: (key) => (key.startsWith('code:') ? 'story ID' : 'title on the same project'),
            findDuplicate: async (row) => {
                const existing = await this.db.projectUserStory.findFirst({
                    where: {
                        tenant_id: tenantId,
                        project_id: row.projectId,
                        ...(row.code
                            ? { code: { equals: row.code, mode: 'insensitive' } }
                            : { title: { equals: row.title, mode: 'insensitive' } }),
                    },
                    select: { id: true },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                await this.create(viewer, {
                    projectId: row.projectId,
                    title: row.title,
                    ...storyFieldsFrom(row),
                    ...(row.code ? { code: row.code } : {}),
                } as CreateUserStoryDto);
            },
            // Blank cells leave the stored value alone — see the task import.
            update: async (id, row) => {
                await this.update(viewer, id, {
                    title: row.title,
                    ...storyFieldsFrom(row),
                } as UpdateUserStoryDto);
            },
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
     * `<project.code>-<reference>`, or the next free number after it when a
     * story was already given that ID by hand — typing `OTB-5` on an older
     * story must not make the fifth story unwritable.
     */
    private async defaultCode(projectId: string, reference: number): Promise<string> {
        const project = await this.db.project.findUnique({
            where: { id: projectId },
            select: { code: true },
        });
        const prefix = project?.code ?? 'US';
        const taken = await this.db.projectUserStory.findMany({
            where: { project_id: projectId, code: { startsWith: `${prefix}-`, mode: 'insensitive' } },
            select: { code: true },
        });
        const used = new Set(taken.map((row) => row.code.toLowerCase()));
        let number = reference;
        while (used.has(`${prefix}-${number}`.toLowerCase())) number += 1;
        return `${prefix}-${number}`;
    }

    /**
     * Story IDs are unique within a project, compared without case so `otb-3`
     * and `OTB-3` cannot both exist and be confused for each other.
     */
    private async assertCodeFree(projectId: string, code: string, exceptId?: string) {
        const clash = await this.db.projectUserStory.findFirst({
            where: {
                project_id: projectId,
                code: { equals: code, mode: 'insensitive' },
                ...(exceptId ? { id: { not: exceptId } } : {}),
            },
            select: { id: true },
        });
        if (clash) throw new ConflictException(`Story ID "${code}" is already used in this project`);
    }

    /**
     * An epic groups one project's stories, so a story can only join an epic in
     * its own project — the rule `assertUserStory` applies one level down.
     */
    private async assertEpicInProject(tenantId: string, epicId: string, projectId: string) {
        const epic = await this.db.projectEpic.findFirst({
            where: { id: epicId, tenant_id: tenantId },
            select: { project_id: true },
        });
        if (!epic) throw new NotFoundException('Epic not found');
        if (epic.project_id !== projectId) {
            throw new BadRequestException('That epic belongs to a different project.');
        }
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

interface StoryImportRow {
    projectId: string;
    epicId: string | null;
    code: string | null;
    title: string;
    asA: string | null;
    iWant: string | null;
    soThat: string | null;
    acceptanceCriteria: string | null;
    status: UserStoryStatusDto | null;
    priority: ProjectPriorityDto | null;
    storyPoints: number | null;
}

/** Only the cells the file filled — a blank one is left out, not cleared. */
function storyFieldsFrom(row: StoryImportRow) {
    return {
        ...(row.asA !== null ? { asA: row.asA } : {}),
        ...(row.iWant !== null ? { iWant: row.iWant } : {}),
        ...(row.soThat !== null ? { soThat: row.soThat } : {}),
        ...(row.acceptanceCriteria !== null ? { acceptanceCriteria: row.acceptanceCriteria } : {}),
        ...(row.status !== null ? { status: row.status } : {}),
        ...(row.priority !== null ? { priority: row.priority } : {}),
        ...(row.storyPoints !== null ? { storyPoints: row.storyPoints } : {}),
        ...(row.epicId !== null ? { epicId: row.epicId } : {}),
    };
}

/** The part of a story row the rollup needs; the rest rides along untouched. */
interface StoryRow {
    id: string;
    [key: string]: unknown;
}
