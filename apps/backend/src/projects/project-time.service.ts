import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { paginate } from '../common/pagination.dto';
import { RemainingHoursService, RemainingSource } from './remaining-hours.service';
import {
    CreateTimeEntryDto,
    ListTimeEntriesDto,
    TimeReportGroupByDto,
    TimeReportQueryDto,
    UpdateTimeEntryDto,
} from './project.dto';

/** What `prisma.groupBy` hands back, narrowed to the keys this file reads. */
interface GroupedRow {
    task_id?: string | null;
    user_id?: string | null;
    project_id?: string | null;
    work_date?: Date | string | null;
    _sum?: { hours: unknown };
    _count?: { _all: number };
}

interface TaskLabel {
    id: string;
    title: string;
    project?: { code: string; name: string } | null;
}
interface UserLabel {
    id: string;
    name: string | null;
    email: string;
}
interface ProjectLabel {
    id: string;
    code: string;
    name: string;
}

export interface ReportRow {
    key: string;
    label: string;
    sublabel: string | null;
    hours: number;
    entries: number;
}

/**
 * Table column id → an `orderBy`. Anything not listed here (an action column,
 * a stale client) falls back to the work date; a sort is never worth failing a
 * page load over.
 */
const TIME_ENTRY_SORTS: Record<string, (dir: 'asc' | 'desc') => Record<string, unknown>[]> = {
    work_date: (dir) => [{ work_date: dir }, { created_at: 'desc' }],
    hours: (dir) => [{ hours: dir }, { created_at: 'desc' }],
    created_at: (dir) => [{ created_at: dir }],
    task: (dir) => [{ task: { title: dir } }, { created_at: 'desc' }],
    project: (dir) => [{ project: { code: dir } }, { created_at: 'desc' }],
    person: (dir) => [{ user: { name: dir } }, { created_at: 'desc' }],
    note: (dir) => [{ note: dir }, { created_at: 'desc' }],
};

/** Hours are money-adjacent; two decimals is what a timesheet is read in. */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * `work_date` is a Prisma `@db.Date`, which arrives as midnight UTC. Formatting
 * it through the local timezone would shift a Dhaka morning back a day, so the
 * UTC parts are read directly.
 */
function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * ISO-8601 week: weeks start Monday and belong to the year holding their
 * Thursday, so the last days of December can legitimately land in week 1.
 */
function isoWeekKey(date: Date): { key: string; label: string; start: Date } {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - dayOfWeek);
    const thursday = new Date(monday);
    thursday.setUTCDate(monday.getUTCDate() + 3);
    const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
    const firstMonday = new Date(firstThursday);
    firstMonday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7));
    const week = Math.round((monday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
    const key = `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    return { key, label: key, start: monday };
}

/** One date row folded into whichever calendar bucket the report asked for. */
function dateBucket(
    date: Date,
    groupBy: TimeReportGroupByDto,
): { key: string; label: string; sublabel: string | null } {
    if (groupBy === TimeReportGroupByDto.WEEK) {
        const week = isoWeekKey(date);
        const end = new Date(week.start);
        end.setUTCDate(week.start.getUTCDate() + 6);
        return {
            key: week.key,
            label: week.label,
            sublabel: `${isoDate(week.start)} — ${isoDate(end)}`,
        };
    }
    if (groupBy === TimeReportGroupByDto.MONTH) {
        const key = isoDate(date).slice(0, 7);
        return { key, label: key, sublabel: null };
    }
    const key = isoDate(date);
    return { key, label: key, sublabel: null };
}

@Injectable()
export class ProjectTimeService {
    constructor(
        private readonly db: DatabaseService,
        private readonly remaining: RemainingHoursService,
        private readonly access: ProjectAccessService,
    ) {}

    /**
     * Every filter the standalone Hour Logs page offers, plus the two the task
     * panel already used. Kept as one `where` builder so the list and the
     * report can never disagree about what a filter means.
     */
    private async buildWhere(
        viewer: ProjectViewer,
        query: { projectId?: string; taskId?: string; userId?: string; from?: string; to?: string; search?: string },
    ): Promise<Record<string, unknown>> {
        const tenantId = viewer.tenantId;
        const where: Record<string, unknown> = {
            tenant_id: tenantId,
            // Hours are the most quietly revealing thing in the module: an
            // entry names its project, its task and who worked on it. The
            // filter goes in the one shared builder so the list, the totals
            // strip and the report can never disagree about it.
            ...(await this.access.relatedFilter(viewer)),
            ...(query.projectId ? { project_id: query.projectId } : {}),
            ...(query.taskId ? { task_id: query.taskId } : {}),
            ...(query.userId ? { user_id: query.userId } : {}),
        };
        if (query.from || query.to) {
            where.work_date = {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
            };
        }
        const term = query.search?.trim();
        if (term) {
            where.OR = [
                { note: { contains: term, mode: 'insensitive' } },
                { task: { title: { contains: term, mode: 'insensitive' } } },
            ];
        }
        return where;
    }

    async list(viewer: ProjectViewer, query: ListTimeEntriesDto) {
        const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
        const page = Math.max(query.page ?? 1, 1);

        const where = await this.buildWhere(viewer, query);

        // Newest work first by default. Every sort but `created_at` breaks its
        // ties on it, so entries sharing a day keep a stable order instead of
        // shuffling between pages.
        const dir = query.sortDir === 'asc' ? 'asc' : 'desc';
        const orderBy = [...(TIME_ENTRY_SORTS[query.sortBy ?? ''] ?? TIME_ENTRY_SORTS.work_date)(dir)];

        const [items, total] = await Promise.all([
            this.db.projectTimeEntry.findMany({
                where: where as never,
                orderBy: orderBy as never,
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    task: { select: { id: true, title: true } },
                    project: { select: { id: true, code: true, name: true } },
                },
            }),
            this.db.projectTimeEntry.count({ where: where as never }),
        ]);

        // Deliberately no hours total here: TransformInterceptor keeps only the
        // five pagination keys, so anything extra would be dropped on the way
        // out. The totals strip comes from `report()`, which the page calls with
        // the same filters.
        return paginate(items, total, page, limit);
    }

    /**
     * Logging time writes two things: the entry, and a re-estimate of what is
     * left. The caller may supply the latter; when they do not we suggest
     * `max(0, remaining - hours)` — a suggestion, never a derivation, because a
     * task can absorb hours and be no closer to finished.
     */
    async create(viewer: ProjectViewer, dto: CreateTimeEntryDto) {
        const tenantId = viewer.tenantId;
        const userId = viewer.userId;
        const task = await this.db.projectTask.findFirst({
            where: {
                id: dto.taskId,
                tenant_id: tenantId,
                deleted_at: null,
                ...(await this.access.relatedFilter(viewer)),
            } as never,
            select: {
                id: true,
                project_id: true,
                sprint_id: true,
                remaining_hours: true,
            },
        });
        if (!task) throw new NotFoundException('Task not found');

        const entry = await this.db.projectTimeEntry.create({
            data: {
                tenant_id: tenantId,
                task_id: dto.taskId,
                project_id: task.project_id,
                user_id: userId,
                work_date: new Date(dto.workDate),
                hours: dto.hours,
                note: dto.note?.trim() || null,
            },
        });

        const previous = task.remaining_hours == null ? null : Number(task.remaining_hours);
        const next =
            dto.remainingHours ?? RemainingHoursService.suggestAfterTimeLog(previous, dto.hours);

        await this.remaining.write({
            tenantId,
            taskId: task.id,
            projectId: task.project_id,
            sprintId: task.sprint_id,
            previousHours: previous,
            newHours: next,
            // An explicit figure alongside a time log is still a re-estimate —
            // labelling it TIME_LOGGED would hide a scope change inside what
            // looks like ordinary progress.
            source:
                dto.remainingHours === undefined
                    ? RemainingSource.TIME_LOGGED
                    : RemainingSource.RE_ESTIMATED,
            timeEntryId: entry.id,
            userId,
        });

        return entry;
    }

    async update(viewer: ProjectViewer, entryId: string, dto: UpdateTimeEntryDto) {
        const entry = await this.db.projectTimeEntry.findFirst({
            where: {
                id: entryId,
                tenant_id: viewer.tenantId,
                ...(await this.access.relatedFilter(viewer)),
            } as never,
            select: { id: true },
        });
        if (!entry) throw new NotFoundException('Time entry not found');

        return this.db.projectTimeEntry.update({
            where: { id: entryId },
            data: {
                ...(dto.workDate !== undefined ? { work_date: new Date(dto.workDate) } : {}),
                ...(dto.hours !== undefined ? { hours: dto.hours } : {}),
                ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
            },
        });
    }

    /**
     * Deleting an entry gives its hours back to the task's remaining figure.
     * Not doing so would leave the sprint permanently short by hours nobody
     * actually worked, with no trace of why.
     */
    async remove(viewer: ProjectViewer, entryId: string) {
        const tenantId = viewer.tenantId;
        const userId = viewer.userId;
        const entry = await this.db.projectTimeEntry.findFirst({
            where: {
                id: entryId,
                tenant_id: tenantId,
                ...(await this.access.relatedFilter(viewer)),
            } as never,
            include: {
                task: {
                    select: { id: true, project_id: true, sprint_id: true, remaining_hours: true },
                },
            },
        });
        if (!entry) throw new NotFoundException('Time entry not found');

        await this.db.projectTimeEntry.delete({ where: { id: entryId } });

        const task = entry.task;
        if (task) {
            const previous = task.remaining_hours == null ? null : Number(task.remaining_hours);
            await this.remaining.write({
                tenantId,
                taskId: task.id,
                projectId: task.project_id,
                sprintId: task.sprint_id,
                previousHours: previous,
                newHours: (previous ?? 0) + Number(entry.hours),
                source: RemainingSource.TIME_ENTRY_DELETED,
                timeEntryId: entryId,
                userId,
            });
        }

        return { success: true };
    }

    /**
     * Hour-log summary over a date range, collapsed to one dimension.
     *
     * Every dimension is aggregated on each call, not just the requested one:
     * the four `groupBy` queries are what make "12 people, 31 tasks, 4 projects,
     * 18 days" possible without a second round trip, and the caller flipping
     * between groupings is the normal way this report is read. Only the labels
     * for the chosen dimension are hydrated.
     */
    async report(viewer: ProjectViewer, query: TimeReportQueryDto) {
        const tenantId = viewer.tenantId;
        const groupBy = query.groupBy ?? TimeReportGroupByDto.TASK;
        const where = await this.buildWhere(viewer, query);

        const [byTask, byUser, byProject, byDate] = await Promise.all([
            this.db.projectTimeEntry.groupBy({
                by: ['task_id'],
                where: where as never,
                _sum: { hours: true },
                _count: { _all: true },
            }),
            this.db.projectTimeEntry.groupBy({
                by: ['user_id'],
                where: where as never,
                _sum: { hours: true },
                _count: { _all: true },
            }),
            this.db.projectTimeEntry.groupBy({
                by: ['project_id'],
                where: where as never,
                _sum: { hours: true },
                _count: { _all: true },
            }),
            this.db.projectTimeEntry.groupBy({
                by: ['work_date'],
                where: where as never,
                _sum: { hours: true },
                _count: { _all: true },
            }),
        ]);

        const totalHours = round2(
            byDate.reduce((sum: number, row: GroupedRow) => sum + Number(row._sum?.hours ?? 0), 0),
        );
        const entries = byDate.reduce(
            (sum: number, row: GroupedRow) => sum + (row._count?._all ?? 0),
            0,
        );

        const rows = await this.buildReportRows(tenantId, groupBy, {
            byTask,
            byUser,
            byProject,
            byDate,
        });

        // Share is of the filtered total, so the column always adds to 100%
        // regardless of which dimension is on screen.
        const withShare = rows.map((row) => ({
            ...row,
            share: totalHours > 0 ? round2((row.hours / totalHours) * 100) : 0,
        }));
        withShare.sort((a, b) =>
            groupBy === TimeReportGroupByDto.TASK
            || groupBy === TimeReportGroupByDto.USER
            || groupBy === TimeReportGroupByDto.PROJECT
                ? b.hours - a.hours
                : a.key.localeCompare(b.key),
        );

        return {
            groupBy,
            from: query.from,
            to: query.to,
            summary: {
                totalHours,
                entries,
                days: byDate.length,
                people: byUser.length,
                tasks: byTask.length,
                projects: byProject.length,
                avgHoursPerDay: byDate.length > 0 ? round2(totalHours / byDate.length) : 0,
            },
            rows: withShare,
        };
    }

    /**
     * Everyone who logged an hour in the range — the options for the "person"
     * filter. Deliberately ignores any `userId` already selected, so choosing a
     * name never collapses the dropdown to that one name.
     */
    async people(viewer: ProjectViewer, query: { from?: string; to?: string; projectId?: string }) {
        const grouped = await this.db.projectTimeEntry.groupBy({
            by: ['user_id'],
            where: (await this.buildWhere(viewer, query)) as never,
            _sum: { hours: true },
        });
        const rows = grouped as GroupedRow[];

        const ids = rows.map((row) => row.user_id as string).filter(Boolean);
        const users = ids.length
            ? await this.db.user.findMany({
                  where: { id: { in: ids } },
                  select: { id: true, name: true, email: true },
              })
            : [];
        const byId = new Map(users.map((user: UserLabel) => [user.id, user]));

        return rows
            .filter((row) => row.user_id)
            .map((row) => {
                const user = byId.get(row.user_id as string);
                return {
                    id: row.user_id as string,
                    name: user?.name ?? null,
                    email: user?.email ?? null,
                    hours: round2(Number(row._sum?.hours ?? 0)),
                };
            })
            .sort((a, b) => (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? ''));
    }

    /** Hydrates the labels for whichever dimension the report is grouped by. */
    private async buildReportRows(
        tenantId: string,
        groupBy: TimeReportGroupByDto,
        grouped: {
            byTask: GroupedRow[];
            byUser: GroupedRow[];
            byProject: GroupedRow[];
            byDate: GroupedRow[];
        },
    ): Promise<ReportRow[]> {
        if (groupBy === TimeReportGroupByDto.TASK) {
            const ids = grouped.byTask.map((row) => row.task_id as string).filter(Boolean);
            const tasks = ids.length
                ? await this.db.projectTask.findMany({
                      where: { id: { in: ids }, tenant_id: tenantId },
                      select: {
                          id: true,
                          title: true,
                          project: { select: { code: true, name: true } },
                      },
                  })
                : [];
            const byId = new Map(tasks.map((task: TaskLabel) => [task.id, task]));
            return grouped.byTask.map((row) => {
                const task = byId.get(row.task_id as string);
                return {
                    key: (row.task_id as string) ?? '',
                    label: task?.title ?? 'Deleted task',
                    // The project code is what tells two identically-titled
                    // tasks apart, so it rides along rather than being a filter.
                    sublabel: task?.project ? `${task.project.code} · ${task.project.name}` : null,
                    hours: round2(Number(row._sum?.hours ?? 0)),
                    entries: row._count?._all ?? 0,
                };
            });
        }

        if (groupBy === TimeReportGroupByDto.USER) {
            const ids = grouped.byUser.map((row) => row.user_id as string).filter(Boolean);
            const users = ids.length
                ? await this.db.user.findMany({
                      where: { id: { in: ids } },
                      select: { id: true, name: true, email: true },
                  })
                : [];
            const byId = new Map(users.map((user: UserLabel) => [user.id, user]));
            return grouped.byUser.map((row) => {
                const user = row.user_id ? byId.get(row.user_id as string) : null;
                return {
                    key: (row.user_id as string) ?? 'unassigned',
                    label: user?.name || user?.email || 'Unattributed',
                    sublabel: user?.name ? user.email : null,
                    hours: round2(Number(row._sum?.hours ?? 0)),
                    entries: row._count?._all ?? 0,
                };
            });
        }

        if (groupBy === TimeReportGroupByDto.PROJECT) {
            const ids = grouped.byProject.map((row) => row.project_id as string).filter(Boolean);
            const projects = ids.length
                ? await this.db.project.findMany({
                      where: { id: { in: ids }, tenant_id: tenantId },
                      select: { id: true, code: true, name: true },
                  })
                : [];
            const byId = new Map(projects.map((project: ProjectLabel) => [project.id, project]));
            return grouped.byProject.map((row) => {
                const project = byId.get(row.project_id as string);
                return {
                    key: (row.project_id as string) ?? '',
                    label: project?.name ?? 'Deleted project',
                    sublabel: project?.code ?? null,
                    hours: round2(Number(row._sum?.hours ?? 0)),
                    entries: row._count?._all ?? 0,
                };
            });
        }

        // date / week / month all fold the same per-day aggregate, so a week
        // total can never disagree with the days it is made of.
        const buckets = new Map<string, { label: string; sublabel: string | null; hours: number; entries: number }>();
        for (const row of grouped.byDate) {
            const date = new Date(row.work_date as Date);
            const bucket = dateBucket(date, groupBy);
            const existing = buckets.get(bucket.key)
                ?? { label: bucket.label, sublabel: bucket.sublabel, hours: 0, entries: 0 };
            existing.hours += Number(row._sum?.hours ?? 0);
            existing.entries += row._count?._all ?? 0;
            buckets.set(bucket.key, existing);
        }
        return [...buckets.entries()].map(([key, value]) => ({
            key,
            label: value.label,
            sublabel: value.sublabel,
            hours: round2(value.hours),
            entries: value.entries,
        }));
    }

    /** Hours per user for a project — the raw material for Phase 2 costing. */
    async summary(viewer: ProjectViewer, projectId: string) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const rows = await this.db.projectTimeEntry.groupBy({
            by: ['user_id'],
            where: { tenant_id: tenantId, project_id: projectId },
            _sum: { hours: true },
        });
        return rows.map((row) => ({
            userId: row.user_id,
            hours: Number(row._sum.hours ?? 0),
        }));
    }
}
