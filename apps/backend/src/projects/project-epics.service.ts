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
    CreateEpicDto,
    EpicStatusDto,
    ListEpicsDto,
    ProjectLabelColorDto,
    ProjectPriorityDto,
    UpdateEpicDto,
} from './project.dto';
import {
    importDate,
    importEnum,
    importText,
    lookup,
    nameIndex,
    requiredText,
} from './project-import.util';

/** What an epic shows beside its title wherever it is listed. */
const EPIC_INCLUDE = {
    project: { select: { id: true, code: true, name: true, short_name: true } },
    creator: { select: { id: true, name: true, email: true } },
} as const;

/** See `ProjectStoriesService` — same allocation, same reasoning. */
const REFERENCE_ATTEMPTS = 5;

/**
 * Epics — the large pieces of scope a project's user stories are grouped under.
 *
 * Built the same way as stories, one level up: an epic holds no work and no
 * size of its own, and its progress is counted from its stories (and their
 * tasks) on every read rather than stored. Its `status` is set by hand.
 *
 * Visibility comes from the project: an epic on a private project reports as
 * missing to anyone who cannot open the project itself.
 */
@Injectable()
export class ProjectEpicsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
    ) {}

    async list(viewer: ProjectViewer, query: ListEpicsDto) {
        const tenantId = viewer.tenantId;
        if (query.projectId) await this.access.assertProjectVisible(viewer, query.projectId);

        const base: Record<string, unknown> = {
            tenant_id: tenantId,
            ...(query.projectId ? { project_id: query.projectId } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(query.priority ? { priority: query.priority } : {}),
            project: { deleted_at: null },
        };

        const search = query.search?.trim();
        if (search) {
            base.OR = [
                { code: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
            ];
        }

        const where = ProjectAccessService.merge(base, await this.access.relatedFilter(viewer));
        const epics = await this.db.projectEpic.findMany({
            where: where as never,
            // Grouped by project across projects, as the story list is.
            orderBy: query.projectId
                ? [{ sort_order: 'asc' }, { reference: 'asc' }]
                : [{ project: { code: 'asc' } }, { sort_order: 'asc' }, { reference: 'asc' }],
            include: EPIC_INCLUDE,
        });

        return this.withProgress(viewer, epics as EpicRow[]);
    }

    /** One epic, with the stories under it in backlog order. */
    async findOne(viewer: ProjectViewer, epicId: string) {
        const epic = await this.assertEpic(viewer, epicId);
        const stories = await this.db.projectUserStory.findMany({
            where: { tenant_id: viewer.tenantId, epic_id: epicId },
            orderBy: [{ sort_order: 'asc' }, { reference: 'asc' }],
            select: {
                id: true,
                reference: true,
                code: true,
                title: true,
                status: true,
                priority: true,
                story_points: true,
            },
        });
        const [withProgress] = await this.withProgress(viewer, [epic]);
        return { ...withProgress, stories };
    }

    async create(viewer: ProjectViewer, dto: CreateEpicDto) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, dto.projectId);

        const sortOrder = dto.sortOrder ?? (await this.nextSortOrder(tenantId, dto.projectId));
        const typedCode = dto.code?.trim() || null;
        if (typedCode) await this.assertCodeFree(dto.projectId, typedCode);

        for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
            try {
                const reference = await this.nextReference(dto.projectId);
                return await this.db.projectEpic.create({
                    data: {
                        tenant_id: tenantId,
                        project_id: dto.projectId,
                        reference,
                        code: typedCode ?? (await this.defaultCode(dto.projectId, reference)),
                        title: dto.title.trim(),
                        description: dto.description?.trim() || null,
                        status: (dto.status ?? 'OPEN') as never,
                        priority: (dto.priority ?? 'MEDIUM') as never,
                        color: (dto.color ?? 'BLUE') as never,
                        start_date: toDate(dto.startDate),
                        target_date: toDate(dto.targetDate),
                        sort_order: sortOrder,
                        created_by: viewer.userId,
                    },
                    include: EPIC_INCLUDE,
                });
            } catch (error: unknown) {
                const code = (error as { code?: string })?.code;
                if (code !== 'P2002' || attempt === REFERENCE_ATTEMPTS - 1) throw error;
                if (typedCode) await this.assertCodeFree(dto.projectId, typedCode);
            }
        }
        throw new BadRequestException('Could not allocate an epic reference.');
    }

    async update(viewer: ProjectViewer, epicId: string, dto: UpdateEpicDto) {
        const epic = await this.assertEpic(viewer, epicId);

        let code: string | undefined;
        if (dto.code !== undefined) {
            code = dto.code.trim();
            if (!code) throw new BadRequestException('Epic ID cannot be empty');
            if (code !== epic.code) await this.assertCodeFree(epic.project_id as string, code, epicId);
        }

        return this.db.projectEpic.update({
            where: { id: epicId },
            data: {
                ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
                ...(code !== undefined ? { code } : {}),
                ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
                ...(dto.status !== undefined ? { status: dto.status as never } : {}),
                ...(dto.priority !== undefined ? { priority: dto.priority as never } : {}),
                ...(dto.color !== undefined ? { color: dto.color as never } : {}),
                ...(dto.startDate !== undefined ? { start_date: toDate(dto.startDate) } : {}),
                ...(dto.targetDate !== undefined ? { target_date: toDate(dto.targetDate) } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
            include: EPIC_INCLUDE,
        });
    }

    /**
     * Epics from a spreadsheet. Matched to an existing epic by ID when the row
     * carries one and by title within the project otherwise, so re-importing a
     * file updates rather than duplicates — the story import's rules.
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

        return runImport<EpicImportRow>(rows, mode, tenantId, {
            requiredFields: ['project', 'title'],
            castRow: (raw) => {
                const code = importText(raw.code);
                if (code && /\s/.test(code)) throw new Error(`Epic ID cannot contain spaces (got "${code}")`);
                if (code && code.length > 40) throw new Error('Epic ID must be 40 characters or fewer');
                return {
                    projectId: lookup(projectIndex, requiredText(raw.project, 'Project'), 'no project matches'),
                    code,
                    title: requiredText(raw.title, 'Title'),
                    description: importText(raw.description),
                    status: importEnum(raw.status, Object.values(EpicStatusDto), 'Status'),
                    priority: importEnum(raw.priority, Object.values(ProjectPriorityDto), 'Priority'),
                    color: importEnum(raw.color, Object.values(ProjectLabelColorDto), 'Color'),
                    startDate: importDate(raw.startDate, 'Start date'),
                    targetDate: importDate(raw.targetDate, 'Target date'),
                };
            },
            dedupeKeys: (row) =>
                row.code
                    ? [`code:${row.projectId}:${row.code.toLowerCase()}`]
                    : [`title:${row.projectId}:${row.title.toLowerCase()}`],
            describeDedupeKey: (key) => (key.startsWith('code:') ? 'epic ID' : 'title on the same project'),
            findDuplicate: async (row) => {
                const existing = await this.db.projectEpic.findFirst({
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
                    ...epicFieldsFrom(row),
                    ...(row.code ? { code: row.code } : {}),
                } as CreateEpicDto);
            },
            update: async (id, row) => {
                await this.update(viewer, id, { title: row.title, ...epicFieldsFrom(row) } as UpdateEpicDto);
            },
        });
    }

    /**
     * Deleting an epic detaches its stories rather than deleting them — the
     * epic was a grouping; the stories are the requirements.
     */
    async remove(viewer: ProjectViewer, epicId: string) {
        const epic = await this.assertEpic(viewer, epicId);
        await this.db.$transaction([
            this.db.projectUserStory.updateMany({
                where: { tenant_id: viewer.tenantId, epic_id: epicId },
                data: { epic_id: null },
            }),
            this.db.projectEpic.delete({ where: { id: epic.id } }),
        ]);
        return { success: true };
    }

    /**
     * Story and task counts per epic, in two queries for the whole list — one
     * for the stories under these epics, one for the tasks under those stories.
     *
     * Stories are counted whatever the viewer's record scope, since a story has
     * no assignee to be scoped by; tasks go through `taskFilter`, so a narrow
     * viewer's task counts match what their task list shows.
     */
    private async withProgress(viewer: ProjectViewer, epics: EpicRow[]) {
        if (epics.length === 0) return [];

        const stories = await this.db.projectUserStory.findMany({
            where: { tenant_id: viewer.tenantId, epic_id: { in: epics.map((epic) => epic.id) } },
            select: { id: true, epic_id: true, status: true, story_points: true },
        });
        const epicOfStory = new Map(stories.map((story) => [story.id, story.epic_id as string]));

        const tasks = stories.length
            ? await this.db.projectTask.findMany({
                  where: ProjectAccessService.merge(
                      {
                          tenant_id: viewer.tenantId,
                          user_story_id: { in: stories.map((story) => story.id) },
                          deleted_at: null,
                      },
                      await this.access.taskFilter(viewer),
                  ) as never,
                  select: { user_story_id: true, status: { select: { category: true } } },
              })
            : [];

        const counts = new Map<string, EpicProgress>();
        const entryFor = (epicId: string) => {
            let entry = counts.get(epicId);
            if (!entry) {
                entry = emptyProgress();
                counts.set(epicId, entry);
            }
            return entry;
        };

        for (const story of stories) {
            if (!story.epic_id) continue;
            const entry = entryFor(story.epic_id);
            const done = story.status === 'DONE';
            entry.storyCount += 1;
            entry.storyPoints += story.story_points ?? 0;
            if (done) {
                entry.doneStoryCount += 1;
                entry.doneStoryPoints += story.story_points ?? 0;
            }
        }
        for (const task of tasks) {
            const epicId = task.user_story_id ? epicOfStory.get(task.user_story_id) : undefined;
            if (!epicId) continue;
            const entry = entryFor(epicId);
            entry.taskCount += 1;
            if (task.status?.category === 'DONE') entry.doneTaskCount += 1;
        }

        return epics.map((epic) => {
            const entry = counts.get(epic.id) ?? emptyProgress();
            return {
                ...epic,
                progress: {
                    ...entry,
                    // Stories are the unit an epic is finished in; tasks are how
                    // far along the unfinished ones are, shown beside it.
                    percentComplete:
                        entry.storyCount === 0
                            ? 0
                            : Math.round((entry.doneStoryCount / entry.storyCount) * 100),
                },
            };
        });
    }

    private async nextSortOrder(tenantId: string, projectId: string): Promise<number> {
        const last = await this.db.projectEpic.findFirst({
            where: { tenant_id: tenantId, project_id: projectId },
            orderBy: { sort_order: 'desc' },
            select: { sort_order: true },
        });
        return (last?.sort_order ?? -1) + 1;
    }

    /** From the highest reference, so a deleted epic's number is never reused. */
    private async nextReference(projectId: string): Promise<number> {
        const last = await this.db.projectEpic.findFirst({
            where: { project_id: projectId },
            orderBy: { reference: 'desc' },
            select: { reference: true },
        });
        return (last?.reference ?? 0) + 1;
    }

    /**
     * `<project.code>-E<reference>`, or the next free number after it when an
     * epic already took that ID by hand.
     */
    private async defaultCode(projectId: string, reference: number): Promise<string> {
        const project = await this.db.project.findUnique({
            where: { id: projectId },
            select: { code: true },
        });
        const prefix = `${project?.code ?? 'EPIC'}-E`;
        const taken = await this.db.projectEpic.findMany({
            where: { project_id: projectId, code: { startsWith: prefix, mode: 'insensitive' } },
            select: { code: true },
        });
        const used = new Set(taken.map((row) => row.code.toLowerCase()));
        let number = reference;
        while (used.has(`${prefix}${number}`.toLowerCase())) number += 1;
        return `${prefix}${number}`;
    }

    private async assertCodeFree(projectId: string, code: string, exceptId?: string) {
        const clash = await this.db.projectEpic.findFirst({
            where: {
                project_id: projectId,
                code: { equals: code, mode: 'insensitive' },
                ...(exceptId ? { id: { not: exceptId } } : {}),
            },
            select: { id: true },
        });
        if (clash) throw new ConflictException(`Epic ID "${code}" is already used in this project`);
    }

    /** Exists, is in this tenant, and hangs off a project this viewer can open. */
    async assertEpic(viewer: ProjectViewer, epicId: string) {
        const epic = await this.db.projectEpic.findFirst({
            where: {
                id: epicId,
                tenant_id: viewer.tenantId,
                project: { deleted_at: null },
                ...(await this.access.relatedFilter(viewer)),
            } as never,
            include: EPIC_INCLUDE,
        });
        if (!epic) throw new NotFoundException('Epic not found');
        return epic as EpicRow;
    }
}

interface EpicProgress {
    storyCount: number;
    doneStoryCount: number;
    storyPoints: number;
    doneStoryPoints: number;
    taskCount: number;
    doneTaskCount: number;
}

function emptyProgress(): EpicProgress {
    return {
        storyCount: 0,
        doneStoryCount: 0,
        storyPoints: 0,
        doneStoryPoints: 0,
        taskCount: 0,
        doneTaskCount: 0,
    };
}

/** `''` clears; undefined never reaches here (callers spread conditionally). */
function toDate(value?: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date.');
    return date;
}

interface EpicImportRow {
    projectId: string;
    code: string | null;
    title: string;
    description: string | null;
    status: EpicStatusDto | null;
    priority: ProjectPriorityDto | null;
    color: ProjectLabelColorDto | null;
    startDate: string | null;
    targetDate: string | null;
}

/** Only the cells the file filled — a blank one is left out, not cleared. */
function epicFieldsFrom(row: EpicImportRow) {
    return {
        ...(row.description !== null ? { description: row.description } : {}),
        ...(row.status !== null ? { status: row.status } : {}),
        ...(row.priority !== null ? { priority: row.priority } : {}),
        ...(row.color !== null ? { color: row.color } : {}),
        ...(row.startDate !== null ? { startDate: row.startDate } : {}),
        ...(row.targetDate !== null ? { targetDate: row.targetDate } : {}),
    };
}

interface EpicRow {
    id: string;
    [key: string]: unknown;
}
