import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { paginate } from '../common/pagination.dto';
import { RemainingHoursService, RemainingSource } from './remaining-hours.service';
import { CreateTimeEntryDto, ListTimeEntriesDto, UpdateTimeEntryDto } from './project.dto';

@Injectable()
export class ProjectTimeService {
    constructor(
        private readonly db: DatabaseService,
        private readonly remaining: RemainingHoursService,
    ) {}

    async list(tenantId: string, query: ListTimeEntriesDto) {
        const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
        const page = Math.max(query.page ?? 1, 1);

        const where: Record<string, unknown> = {
            tenant_id: tenantId,
            ...(query.projectId ? { project_id: query.projectId } : {}),
            ...(query.taskId ? { task_id: query.taskId } : {}),
        };
        if (query.from || query.to) {
            where.work_date = {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
            };
        }

        const [items, total] = await Promise.all([
            this.db.projectTimeEntry.findMany({
                where: where as never,
                orderBy: [{ work_date: 'desc' }, { created_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    task: { select: { id: true, title: true } },
                },
            }),
            this.db.projectTimeEntry.count({ where: where as never }),
        ]);

        return paginate(items, total, page, limit);
    }

    /**
     * Logging time writes two things: the entry, and a re-estimate of what is
     * left. The caller may supply the latter; when they do not we suggest
     * `max(0, remaining - hours)` — a suggestion, never a derivation, because a
     * task can absorb hours and be no closer to finished.
     */
    async create(tenantId: string, userId: string, dto: CreateTimeEntryDto) {
        const task = await this.db.projectTask.findFirst({
            where: { id: dto.taskId, tenant_id: tenantId, deleted_at: null },
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

    async update(tenantId: string, entryId: string, dto: UpdateTimeEntryDto) {
        const entry = await this.db.projectTimeEntry.findFirst({
            where: { id: entryId, tenant_id: tenantId },
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
    async remove(tenantId: string, userId: string, entryId: string) {
        const entry = await this.db.projectTimeEntry.findFirst({
            where: { id: entryId, tenant_id: tenantId },
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

    /** Hours per user for a project — the raw material for Phase 2 costing. */
    async summary(tenantId: string, projectId: string) {
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
