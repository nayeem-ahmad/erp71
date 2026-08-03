import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectSettingsService } from './project-settings.service';
import { paginate } from '../common/pagination.dto';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import {
    CreateMilestoneDto,
    CreateProjectDto,
    ListProjectsDto,
    UpdateMilestoneDto,
    UpdateProjectDto,
    UpsertProjectMemberDto,
} from './project.dto';

const PROJECT_SORTABLE: SortableMap = {
    code: (dir) => ({ code: dir }),
    name: (dir) => ({ name: dir }),
    status: (dir) => ({ status: dir }),
    priority: (dir) => ({ priority: dir }),
    start_date: (dir) => ({ start_date: dir }),
    target_end_date: (dir) => ({ target_end_date: dir }),
    created_at: (dir) => ({ created_at: dir }),
};

const VALID_STATUSES = ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

/** A member is a user or an employee; both sides are always loaded. */
const MEMBER_INCLUDE = {
    user: { select: { id: true, name: true, email: true } },
    employee: { select: { id: true, name: true, employee_code: true } },
} as const;

@Injectable()
export class ProjectsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly settings: ProjectSettingsService,
    ) {}

    /**
     * `PRJ-0001` per tenant. Derived from the current count rather than a
     * sequence table, and retried on unique violation, because two concurrent
     * creates would otherwise pick the same number.
     */
    private async nextCode(tenantId: string): Promise<string> {
        const count = await this.db.project.count({ where: { tenant_id: tenantId } });
        return `PRJ-${String(count + 1).padStart(4, '0')}`;
    }

    private toDate(value?: string): Date | undefined {
        if (!value) return undefined;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date.');
        return date;
    }

    async list(tenantId: string, query: ListProjectsDto) {
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
        const page = Math.max(query.page ?? 1, 1);

        const statuses = (query.status ?? '')
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => VALID_STATUSES.includes(s));

        const where: Record<string, unknown> = {
            tenant_id: tenantId,
            deleted_at: null,
            ...(statuses.length ? { status: { in: statuses } } : {}),
            ...(query.projectTypeId ? { project_type_id: query.projectTypeId } : {}),
            ...(query.managerId ? { manager_id: query.managerId } : {}),
            ...(query.customerId ? { customer_id: query.customerId } : {}),
        };

        const search = query.search?.trim();
        if (search) {
            where.OR = [
                { code: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { customer: { name: { contains: search, mode: 'insensitive' } } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.project.findMany({
                where: where as never,
                orderBy: resolveOrderBy(query.sortBy, query.sortDir, PROJECT_SORTABLE, {
                    created_at: 'desc',
                }) as never,
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    customer: { select: { id: true, name: true } },
                    projectType: { select: { id: true, name: true } },
                    manager: { select: { id: true, name: true, email: true } },
                    _count: { select: { tasks: true } },
                },
            }),
            this.db.project.count({ where: where as never }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const project = await this.db.project.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: {
                customer: { select: { id: true, name: true, phone: true } },
                lead: { select: { id: true, name: true } },
                projectType: { select: { id: true, name: true } },
                manager: { select: { id: true, name: true, email: true } },
                store: { select: { id: true, name: true } },
                members: {
                    include: MEMBER_INCLUDE,
                    orderBy: { created_at: 'asc' },
                },
                milestones: { orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] },
            },
        });
        if (!project) throw new NotFoundException('Project not found');

        // Percent complete is derived, never stored — a stored copy drifts the
        // moment a task moves and nobody recalculates it.
        const progress = await this.progress(tenantId, id);
        return { ...project, progress };
    }

    /** Task counts and hour totals for a project, and per milestone. */
    async progress(tenantId: string, projectId: string) {
        const tasks = await this.db.projectTask.findMany({
            where: { tenant_id: tenantId, project_id: projectId, deleted_at: null },
            select: {
                id: true,
                milestone_id: true,
                estimate_hours: true,
                remaining_hours: true,
                status: { select: { category: true } },
            },
        });

        const logged = await this.db.projectTimeEntry.aggregate({
            where: { tenant_id: tenantId, project_id: projectId },
            _sum: { hours: true },
        });

        const done = tasks.filter((t) => t.status?.category === 'DONE');
        const byMilestone = new Map<string, { total: number; done: number }>();
        for (const task of tasks) {
            if (!task.milestone_id) continue;
            const entry = byMilestone.get(task.milestone_id) ?? { total: 0, done: 0 };
            entry.total += 1;
            if (task.status?.category === 'DONE') entry.done += 1;
            byMilestone.set(task.milestone_id, entry);
        }

        return {
            taskCount: tasks.length,
            doneTaskCount: done.length,
            percentComplete: tasks.length === 0 ? 0 : Math.round((done.length / tasks.length) * 100),
            estimatedHours: sum(tasks.map((t) => num(t.estimate_hours))),
            remainingHours: sum(tasks.map((t) => num(t.remaining_hours))),
            loggedHours: num(logged._sum.hours),
            milestones: [...byMilestone.entries()].map(([id, v]) => ({
                milestoneId: id,
                taskCount: v.total,
                doneTaskCount: v.done,
                percentComplete: v.total === 0 ? 0 : Math.round((v.done / v.total) * 100),
            })),
        };
    }

    async create(tenantId: string, userId: string, dto: CreateProjectDto) {
        if (dto.customerId) await this.assertCustomer(tenantId, dto.customerId);
        if (dto.projectTypeId) await this.assertProjectType(tenantId, dto.projectTypeId);

        // Retry the code on collision rather than locking: concurrent creates
        // are rare and a second attempt is cheaper than serialising them all.
        for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
                const project = await this.db.project.create({
                    data: {
                        tenant_id: tenantId,
                        code: await this.nextCode(tenantId),
                        name: dto.name.trim(),
                        description: dto.description?.trim() || null,
                        store_id: dto.storeId ?? null,
                        customer_id: dto.customerId ?? null,
                        lead_id: dto.leadId ?? null,
                        project_type_id: dto.projectTypeId ?? null,
                        status: (dto.status ?? 'DRAFT') as never,
                        priority: (dto.priority ?? 'MEDIUM') as never,
                        manager_id: dto.managerId ?? userId,
                        start_date: this.toDate(dto.startDate) ?? null,
                        target_end_date: this.toDate(dto.targetEndDate) ?? null,
                        budget_amount: dto.budgetAmount ?? null,
                        created_by: userId,
                    },
                });

                // Columns belong to a project as of Phase 3L. Seeding here means
                // a board is usable the moment it exists; `listTaskStatuses`
                // also seeds lazily, so a failure at this point is recoverable
                // rather than a permanently empty board.
                await this.settings.seedProjectColumns(tenantId, project.id);
                return project;
            } catch (error: unknown) {
                const code = (error as { code?: string })?.code;
                if (code !== 'P2002' || attempt === 4) throw error;
            }
        }
        throw new BadRequestException('Could not allocate a project code.');
    }

    async update(tenantId: string, id: string, dto: UpdateProjectDto) {
        await this.assertProject(tenantId, id);
        if (dto.customerId) await this.assertCustomer(tenantId, dto.customerId);
        if (dto.projectTypeId) await this.assertProjectType(tenantId, dto.projectTypeId);

        return this.db.project.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
                ...(dto.storeId !== undefined ? { store_id: dto.storeId || null } : {}),
                ...(dto.customerId !== undefined ? { customer_id: dto.customerId || null } : {}),
                ...(dto.leadId !== undefined ? { lead_id: dto.leadId || null } : {}),
                ...(dto.projectTypeId !== undefined ? { project_type_id: dto.projectTypeId || null } : {}),
                ...(dto.status !== undefined ? { status: dto.status as never } : {}),
                ...(dto.priority !== undefined ? { priority: dto.priority as never } : {}),
                ...(dto.managerId !== undefined ? { manager_id: dto.managerId || null } : {}),
                ...(dto.startDate !== undefined ? { start_date: this.toDate(dto.startDate) ?? null } : {}),
                ...(dto.targetEndDate !== undefined
                    ? { target_end_date: this.toDate(dto.targetEndDate) ?? null }
                    : {}),
                ...(dto.actualEndDate !== undefined
                    ? { actual_end_date: this.toDate(dto.actualEndDate) ?? null }
                    : {}),
                ...(dto.budgetAmount !== undefined ? { budget_amount: dto.budgetAmount ?? null } : {}),
            },
        });
    }

    /**
     * Soft delete. Tasks and time entries are deliberately left in place — they
     * are the record of work that was actually done and of hours already costed.
     *
     * The project's tasks are detached from any sprint first. Sprints are
     * tenant-level and shared, so a deleted project must not leave phantom rows
     * inflating a live sprint's committed hours. Same reasoning as
     * `removeMilestone`, which detaches rather than cascades.
     */
    async remove(tenantId: string, id: string) {
        await this.assertProject(tenantId, id);
        await this.db.$transaction([
            this.db.projectTask.updateMany({
                where: { tenant_id: tenantId, project_id: id, sprint_id: { not: null } },
                data: { sprint_id: null },
            }),
            this.db.project.update({ where: { id }, data: { deleted_at: new Date() } }),
        ]);
        return { success: true };
    }

    // ── Members ────────────────────────────────────────────────────────────

    /**
     * A member is either a workspace user or an employee with no login. Prisma
     * cannot express "exactly one of", so it is enforced here — the alternative
     * is a row that belongs to nobody or to two people.
     */
    async addMember(tenantId: string, projectId: string, dto: UpsertProjectMemberDto) {
        await this.assertProject(tenantId, projectId);
        if (Boolean(dto.userId) === Boolean(dto.employeeId)) {
            throw new BadRequestException('Pick either a workspace user or an employee, not both.');
        }

        if (dto.employeeId) {
            const employee = await this.db.employee.findFirst({
                where: { id: dto.employeeId, tenant_id: tenantId, deleted_at: null },
                select: { id: true },
            });
            if (!employee) throw new BadRequestException('That employee is not in this workspace.');
            return this.upsertMemberRow(tenantId, projectId, dto, { employee_id: dto.employeeId });
        }

        const member = await this.db.tenantUser.findFirst({
            where: { tenant_id: tenantId, user_id: dto.userId },
            select: { id: true },
        });
        if (!member) throw new BadRequestException('That user is not part of this workspace.');

        return this.upsertMemberRow(tenantId, projectId, dto, { user_id: dto.userId });
    }

    private async upsertMemberRow(
        tenantId: string,
        projectId: string,
        dto: UpsertProjectMemberDto,
        key: { user_id?: string; employee_id?: string },
    ) {
        const role = (dto.role ?? 'MEMBER') as never;
        const where = key.user_id
            ? { project_id_user_id: { project_id: projectId, user_id: key.user_id } }
            : { project_id_employee_id: { project_id: projectId, employee_id: key.employee_id! } };

        return this.db.projectMember.upsert({
            where: where as never,
            create: { tenant_id: tenantId, project_id: projectId, ...key, role },
            update: { role },
            include: MEMBER_INCLUDE,
        });
    }

    /** Keyed on the member row, not the user — an employee member has no user id. */
    async removeMember(tenantId: string, projectId: string, memberId: string) {
        await this.assertProject(tenantId, projectId);
        await this.db.projectMember.deleteMany({
            where: { tenant_id: tenantId, project_id: projectId, id: memberId },
        });
        return { success: true };
    }

    // ── Milestones ─────────────────────────────────────────────────────────

    async createMilestone(tenantId: string, projectId: string, dto: CreateMilestoneDto) {
        await this.assertProject(tenantId, projectId);
        return this.db.projectMilestone.create({
            data: {
                tenant_id: tenantId,
                project_id: projectId,
                name: dto.name.trim(),
                target_date: this.toDate(dto.targetDate) ?? null,
                sort_order: dto.sortOrder ?? 0,
            },
        });
    }

    async updateMilestone(tenantId: string, milestoneId: string, dto: UpdateMilestoneDto) {
        const milestone = await this.db.projectMilestone.findFirst({
            where: { id: milestoneId, tenant_id: tenantId },
            select: { id: true, completed_at: true },
        });
        if (!milestone) throw new NotFoundException('Milestone not found');

        return this.db.projectMilestone.update({
            where: { id: milestoneId },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.targetDate !== undefined
                    ? { target_date: this.toDate(dto.targetDate) ?? null }
                    : {}),
                ...(dto.isCompleted !== undefined
                    ? { completed_at: dto.isCompleted ? (milestone.completed_at ?? new Date()) : null }
                    : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
        });
    }

    async removeMilestone(tenantId: string, milestoneId: string) {
        const milestone = await this.db.projectMilestone.findFirst({
            where: { id: milestoneId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!milestone) throw new NotFoundException('Milestone not found');
        // Tasks keep existing, they just lose the grouping.
        await this.db.projectTask.updateMany({
            where: { tenant_id: tenantId, milestone_id: milestoneId },
            data: { milestone_id: null },
        });
        await this.db.projectMilestone.delete({ where: { id: milestoneId } });
        return { success: true };
    }

    // ── Guards ─────────────────────────────────────────────────────────────

    async assertProject(tenantId: string, projectId: string) {
        const project = await this.db.project.findFirst({
            where: { id: projectId, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!project) throw new NotFoundException('Project not found');
        return project;
    }

    private async assertCustomer(tenantId: string, customerId: string) {
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');
    }

    private async assertProjectType(tenantId: string, projectTypeId: string) {
        const type = await this.db.projectType.findFirst({
            where: { id: projectTypeId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!type) throw new NotFoundException('Project type not found');
    }
}

function num(value: unknown): number {
    if (value == null) return 0;
    return Number(value);
}

function sum(values: number[]): number {
    return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}
