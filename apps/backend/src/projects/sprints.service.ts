import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SprintSnapshotService } from './sprint-snapshot.service';
import { buildBurndownSeries, toDateKey } from './burndown.util';
import { AssignTasksToSprintDto, CreateSprintDto, UpdateSprintDto } from './project.dto';

@Injectable()
export class SprintsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly snapshots: SprintSnapshotService,
    ) {}

    async list(tenantId: string, projectId: string) {
        const sprints = await this.db.sprint.findMany({
            where: { tenant_id: tenantId, project_id: projectId },
            orderBy: [{ start_date: 'desc' }],
            include: { _count: { select: { tasks: true } } },
        });

        // Hour totals per sprint in one grouped query rather than one per row.
        const totals = await this.db.projectTask.groupBy({
            by: ['sprint_id'],
            where: {
                tenant_id: tenantId,
                project_id: projectId,
                deleted_at: null,
                sprint_id: { not: null },
            },
            _sum: { estimate_hours: true, remaining_hours: true },
        });
        const bySprint = new Map(
            totals.map((t) => [
                t.sprint_id,
                {
                    estimated: Number(t._sum.estimate_hours ?? 0),
                    remaining: Number(t._sum.remaining_hours ?? 0),
                },
            ]),
        );

        return sprints.map((sprint) => ({
            ...sprint,
            estimated_hours: bySprint.get(sprint.id)?.estimated ?? 0,
            remaining_hours: bySprint.get(sprint.id)?.remaining ?? 0,
        }));
    }

    async findOne(tenantId: string, sprintId: string) {
        const sprint = await this.db.sprint.findFirst({
            where: { id: sprintId, tenant_id: tenantId },
            include: { project: { select: { id: true, name: true, code: true } } },
        });
        if (!sprint) throw new NotFoundException('Sprint not found');
        return sprint;
    }

    async create(tenantId: string, dto: CreateSprintDto) {
        const project = await this.db.project.findFirst({
            where: { id: dto.projectId, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!project) throw new NotFoundException('Project not found');

        const start = new Date(dto.startDate);
        const end = new Date(dto.endDate);
        if (end < start) throw new BadRequestException('A sprint cannot end before it starts.');

        return this.db.sprint.create({
            data: {
                tenant_id: tenantId,
                project_id: dto.projectId,
                name: dto.name.trim(),
                goal: dto.goal?.trim() || null,
                start_date: start,
                end_date: end,
            },
        });
    }

    async update(tenantId: string, sprintId: string, dto: UpdateSprintDto) {
        const sprint = await this.findOne(tenantId, sprintId);

        const start = dto.startDate ? new Date(dto.startDate) : sprint.start_date;
        const end = dto.endDate ? new Date(dto.endDate) : sprint.end_date;
        if (end < start) throw new BadRequestException('A sprint cannot end before it starts.');

        if (dto.status === 'ACTIVE' && sprint.status !== 'ACTIVE') {
            await this.assertNoOtherActive(tenantId, sprint.project_id, sprintId);
        }

        return this.db.sprint.update({
            where: { id: sprintId },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.goal !== undefined ? { goal: dto.goal?.trim() || null } : {}),
                ...(dto.startDate !== undefined ? { start_date: start } : {}),
                ...(dto.endDate !== undefined ? { end_date: end } : {}),
                ...(dto.status !== undefined ? { status: dto.status as never } : {}),
            },
        });
    }

    /**
     * Starting a sprint takes a snapshot immediately, so day one has a point
     * and the burndown has something to anchor its ideal line to.
     */
    async start(tenantId: string, sprintId: string) {
        const sprint = await this.findOne(tenantId, sprintId);
        if (sprint.status === 'COMPLETED') {
            throw new BadRequestException('That sprint is already complete.');
        }
        await this.assertNoOtherActive(tenantId, sprint.project_id, sprintId);

        const updated = await this.db.sprint.update({
            where: { id: sprintId },
            data: { status: 'ACTIVE' as never },
        });
        await this.snapshots.snapshotToday(tenantId, sprintId);
        return updated;
    }

    /**
     * Completing a sprint snapshots one last time, then returns unfinished
     * tasks to the backlog. They keep their remaining hours — the work did not
     * evaporate because the sprint ended — and their log rows keep pointing at
     * the sprint they burned in.
     */
    async complete(tenantId: string, sprintId: string) {
        const sprint = await this.findOne(tenantId, sprintId);
        await this.snapshots.snapshotToday(tenantId, sprintId);

        const carried = await this.db.projectTask.findMany({
            where: {
                tenant_id: tenantId,
                sprint_id: sprintId,
                deleted_at: null,
                status: { category: { not: 'DONE' } },
            },
            select: { id: true },
        });

        await this.db.projectTask.updateMany({
            where: { id: { in: carried.map((t) => t.id) } },
            data: { sprint_id: null },
        });

        const updated = await this.db.sprint.update({
            where: { id: sprintId },
            data: { status: 'COMPLETED' as never },
        });
        return { ...updated, carried_over: carried.length };
    }

    async assignTasks(tenantId: string, sprintId: string, dto: AssignTasksToSprintDto) {
        const sprint = await this.findOne(tenantId, sprintId);
        const result = await this.db.projectTask.updateMany({
            where: {
                tenant_id: tenantId,
                project_id: sprint.project_id,
                id: { in: dto.taskIds },
                deleted_at: null,
            },
            data: { sprint_id: sprintId },
        });
        return { assigned: result.count };
    }

    async removeTasks(tenantId: string, sprintId: string, dto: AssignTasksToSprintDto) {
        await this.findOne(tenantId, sprintId);
        const result = await this.db.projectTask.updateMany({
            where: { tenant_id: tenantId, sprint_id: sprintId, id: { in: dto.taskIds } },
            data: { sprint_id: null },
        });
        return { removed: result.count };
    }

    async remove(tenantId: string, sprintId: string) {
        await this.findOne(tenantId, sprintId);
        await this.db.projectTask.updateMany({
            where: { tenant_id: tenantId, sprint_id: sprintId },
            data: { sprint_id: null },
        });
        await this.db.sprint.delete({ where: { id: sprintId } });
        return { success: true };
    }

    /** The three series the chart draws, plus the sprint's current totals. */
    async burndown(tenantId: string, sprintId: string) {
        const sprint = await this.findOne(tenantId, sprintId);
        const rows = await this.db.sprintSnapshot.findMany({
            where: { tenant_id: tenantId, sprint_id: sprintId },
            orderBy: { snapshot_date: 'asc' },
        });

        const snapshots = new Map(
            rows.map((row) => [
                toDateKey(row.snapshot_date),
                {
                    remaining: Number(row.remaining_hours),
                    committed: Number(row.committed_hours),
                },
            ]),
        );

        const current = await this.snapshots.computeCurrent(tenantId, sprintId);
        return {
            sprint: {
                id: sprint.id,
                name: sprint.name,
                goal: sprint.goal,
                status: sprint.status,
                start_date: sprint.start_date,
                end_date: sprint.end_date,
            },
            current,
            series: buildBurndownSeries({
                startDate: sprint.start_date,
                endDate: sprint.end_date,
                snapshots,
            }),
        };
    }

    async rebuildSnapshots(tenantId: string, sprintId: string, overwrite = false) {
        await this.findOne(tenantId, sprintId);
        return this.snapshots.rebuild(tenantId, sprintId, { overwrite });
    }

    /**
     * One active sprint per project. More than one makes "the board" ambiguous
     * and gives the burndown two candidate sprints to draw.
     */
    private async assertNoOtherActive(tenantId: string, projectId: string, exceptId: string) {
        const active = await this.db.sprint.findFirst({
            where: {
                tenant_id: tenantId,
                project_id: projectId,
                status: 'ACTIVE' as never,
                id: { not: exceptId },
            },
            select: { id: true, name: true },
        });
        if (active) {
            throw new ConflictException(
                `"${active.name}" is already running. Complete it before starting another sprint.`,
            );
        }
    }
}
