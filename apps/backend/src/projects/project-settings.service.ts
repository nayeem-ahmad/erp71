import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    CreateLabelDto,
    CreateProjectTypeDto,
    CreateTaskStatusDto,
    TimeTagDto,
    UpdateLabelDto,
    UpdateProjectTypeDto,
    UpdateTaskStatusDto,
} from './project.dto';

/**
 * The columns a tenant gets before they configure anything. Seeded lazily on
 * first use rather than at tenant creation, so existing tenants pick them up
 * the moment the module is switched on for them — no backfill migration.
 */
export const DEFAULT_TASK_STATUSES = [
    { name: 'To Do', category: 'TODO', sort_order: 0, is_default: true },
    { name: 'In Progress', category: 'IN_PROGRESS', sort_order: 1, is_default: false },
    { name: 'In Review', category: 'IN_PROGRESS', sort_order: 2, is_default: false },
    { name: 'Done', category: 'DONE', sort_order: 3, is_default: false },
] as const;

@Injectable()
export class ProjectSettingsService {
    constructor(private readonly db: DatabaseService) {}

    // ── Board columns ──────────────────────────────────────────────────────

    /**
     * Columns for one project, or the tenant template when `projectId` is
     * omitted.
     *
     * Both are lazily seeded on first read — the template from
     * `DEFAULT_TASK_STATUSES`, a project from the template — so a project
     * created before Phase 3L, or by a path that forgot to seed it, still has a
     * board rather than an empty screen.
     */
    async listTaskStatuses(tenantId: string, includeInactive = false, projectId?: string) {
        const where = {
            tenant_id: tenantId,
            project_id: projectId ?? null,
            ...(includeInactive ? {} : { is_active: true }),
        };
        const order = [{ sort_order: 'asc' as const }, { created_at: 'asc' as const }];

        const existing = await this.db.projectTaskStatus.findMany({ where, orderBy: order });
        if (existing.length > 0) return existing;

        if (projectId) await this.seedProjectColumns(tenantId, projectId);
        else await this.seedDefaults(tenantId);

        return this.db.projectTaskStatus.findMany({ where, orderBy: order });
    }

    /**
     * Gives a project its own copy of the tenant template. Idempotent via
     * `skipDuplicates` on the (tenant, project, name) unique, so two concurrent
     * first-loads of a board cannot leave it with doubled columns.
     */
    async seedProjectColumns(tenantId: string, projectId: string) {
        const template = await this.listTaskStatuses(tenantId, true);
        if (template.length === 0) return;

        await this.db.projectTaskStatus.createMany({
            data: template.map((status) => ({
                tenant_id: tenantId,
                project_id: projectId,
                name: status.name,
                category: status.category as never,
                sort_order: status.sort_order,
                is_active: status.is_active,
                is_default: status.is_default,
            })),
            skipDuplicates: true,
        });

        await this.adoptTasksFromTemplate(tenantId, projectId);
    }

    /**
     * Moves a project's tasks off the tenant template and onto its own copies,
     * matching by column name.
     *
     * **This is not belt-and-braces for the migration — in production it is the
     * only thing that runs.** The container applies the schema with
     * `prisma db push` (`apps/backend/Dockerfile`), never `migrate deploy`, so
     * the SQL under `prisma/migrations/` is documentation there. `db push` would
     * add `project_id` and leave every task pointing at a template row, which
     * matches none of the project's own columns — every board built from those
     * tasks would render empty.
     *
     * Idempotent: after it runs, no task in this project is on a template row.
     */
    async adoptTasksFromTemplate(tenantId: string, projectId: string) {
        const [templates, own] = await Promise.all([
            this.db.projectTaskStatus.findMany({
                where: { tenant_id: tenantId, project_id: null },
                select: { id: true, name: true },
            }),
            this.db.projectTaskStatus.findMany({
                where: { tenant_id: tenantId, project_id: projectId },
                select: { id: true, name: true },
            }),
        ]);

        const byName = new Map(own.map((column) => [column.name, column.id]));

        for (const template of templates) {
            const target = byName.get(template.name);
            // No same-named column on this board — the task stays where it is
            // rather than being moved somewhere arbitrary. `board()` will still
            // not show it, but a visible gap beats a silent reassignment.
            if (!target) continue;

            await this.db.projectTask.updateMany({
                where: { tenant_id: tenantId, project_id: projectId, status_id: template.id },
                data: { status_id: target },
            });
        }
    }

    /**
     * `createMany` with `skipDuplicates` so two concurrent first-requests cannot
     * both seed and leave the tenant with doubled columns.
     */
    private async seedDefaults(tenantId: string) {
        await this.db.projectTaskStatus.createMany({
            data: DEFAULT_TASK_STATUSES.map((status) => ({
                tenant_id: tenantId,
                name: status.name,
                category: status.category as never,
                sort_order: status.sort_order,
                is_default: status.is_default,
            })),
            skipDuplicates: true,
        });
    }

    /** The column a new task lands in. Falls back to the first by sort order. */
    async defaultTaskStatus(tenantId: string, projectId?: string) {
        const statuses = await this.listTaskStatuses(tenantId, false, projectId);
        if (statuses.length === 0) throw new BadRequestException('No board columns are configured.');
        return statuses.find((s) => s.is_default) ?? statuses[0];
    }

    async createTaskStatus(tenantId: string, dto: CreateTaskStatusDto, projectId?: string) {
        await this.listTaskStatuses(tenantId, true, projectId);
        const name = dto.name.trim();
        const scope = { tenant_id: tenantId, project_id: projectId ?? null };

        // Checked in code rather than left to the unique index: Postgres treats
        // NULLs as distinct, so the index does not constrain template rows.
        const clash = await this.db.projectTaskStatus.findFirst({
            where: { ...scope, name },
            select: { id: true },
        });
        if (clash) throw new ConflictException('A column with that name already exists.');

        if (dto.isDefault) await this.clearDefault(tenantId, projectId);
        const count = await this.db.projectTaskStatus.count({ where: scope });
        return this.db.projectTaskStatus.create({
            data: {
                tenant_id: tenantId,
                project_id: projectId ?? null,
                name,
                category: dto.category as never,
                sort_order: dto.sortOrder ?? count,
                is_default: dto.isDefault ?? false,
                wip_limit: dto.wipLimit ?? null,
            },
        });
    }

    async updateTaskStatus(tenantId: string, id: string, dto: UpdateTaskStatusDto) {
        const status = await this.assertTaskStatus(tenantId, id);

        if (dto.name && dto.name.trim() !== status.name) {
            const clash = await this.db.projectTaskStatus.findFirst({
                where: {
                    tenant_id: tenantId,
                    project_id: status.project_id,
                    name: dto.name.trim(),
                    id: { not: id },
                },
                select: { id: true },
            });
            if (clash) throw new ConflictException('A column with that name already exists.');
        }

        // Deactivating a column that still holds tasks would hide them from the
        // board with no way back, so it is refused rather than silently done.
        if (dto.isActive === false) {
            const held = await this.db.projectTask.count({
                where: { tenant_id: tenantId, status_id: id, deleted_at: null },
            });
            if (held > 0) {
                throw new BadRequestException(
                    `Move the ${held} task(s) in this column somewhere else before deactivating it.`,
                );
            }
        }

        if (dto.isDefault) await this.clearDefault(tenantId, status.project_id ?? undefined);

        return this.db.projectTaskStatus.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.category !== undefined ? { category: dto.category as never } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
                ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
                ...(dto.isDefault !== undefined ? { is_default: dto.isDefault } : {}),
                ...(dto.wipLimit !== undefined ? { wip_limit: dto.wipLimit } : {}),
            },
        });
    }

    async removeTaskStatus(tenantId: string, id: string) {
        await this.assertTaskStatus(tenantId, id);
        const held = await this.db.projectTask.count({
            where: { tenant_id: tenantId, status_id: id, deleted_at: null },
        });
        if (held > 0) {
            throw new BadRequestException(
                `Move the ${held} task(s) in this column somewhere else before deleting it.`,
            );
        }
        await this.db.projectTaskStatus.delete({ where: { id } });
        return { success: true };
    }

    // ── Labels ─────────────────────────────────────────────────────────────

    async listLabels(tenantId: string) {
        return this.db.projectLabel.findMany({
            where: { tenant_id: tenantId },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        });
    }

    async createLabel(tenantId: string, dto: CreateLabelDto) {
        const name = dto.name.trim();
        const clash = await this.db.projectLabel.findFirst({
            where: { tenant_id: tenantId, name },
            select: { id: true },
        });
        if (clash) throw new ConflictException('A label with that name already exists.');

        const count = await this.db.projectLabel.count({ where: { tenant_id: tenantId } });
        return this.db.projectLabel.create({
            data: {
                tenant_id: tenantId,
                name,
                color: (dto.color ?? 'GRAY') as never,
                sort_order: count,
            },
        });
    }

    async updateLabel(tenantId: string, id: string, dto: UpdateLabelDto) {
        await this.assertLabel(tenantId, id);

        if (dto.name !== undefined) {
            const name = dto.name.trim();
            const clash = await this.db.projectLabel.findFirst({
                where: { tenant_id: tenantId, name, id: { not: id } },
                select: { id: true },
            });
            if (clash) throw new ConflictException('A label with that name already exists.');
        }

        return this.db.projectLabel.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.color !== undefined ? { color: dto.color as never } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
        });
    }

    /**
     * Unlike a board column, a label in use is deleted rather than refused —
     * removing "Blocked" from the vocabulary should not require untagging
     * fifty cards first. The join rows cascade; the tasks are untouched.
     */
    async removeLabel(tenantId: string, id: string) {
        await this.assertLabel(tenantId, id);
        const tagged = await this.db.projectTaskLabel.count({
            where: { tenant_id: tenantId, label_id: id },
        });
        await this.db.projectLabel.delete({ where: { id } });
        return { success: true, untagged: tagged };
    }

    private async assertLabel(tenantId: string, id: string) {
        const label = await this.db.projectLabel.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true },
        });
        if (!label) throw new NotFoundException('Label not found');
        return label;
    }

    // ── Hour-log tags ──────────────────────────────────────────────────────
    //
    // A separate vocabulary from labels on purpose — see the model comment.
    // The CRUD is deliberately the same shape as the label CRUD above rather
    // than a shared generic: two tables that happen to look alike today are
    // not one table, and the first thing a tag grows that a label does not
    // (a billable flag, a default rate) would have to unpick the abstraction.

    async listTimeTags(tenantId: string) {
        return this.db.projectTimeTag.findMany({
            where: { tenant_id: tenantId },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        });
    }

    async createTimeTag(tenantId: string, dto: TimeTagDto) {
        const name = dto.name.trim();
        const clash = await this.db.projectTimeTag.findFirst({
            where: { tenant_id: tenantId, name },
            select: { id: true },
        });
        if (clash) throw new ConflictException('A tag with that name already exists.');

        const count = await this.db.projectTimeTag.count({ where: { tenant_id: tenantId } });
        return this.db.projectTimeTag.create({
            data: {
                tenant_id: tenantId,
                name,
                color: (dto.color ?? 'GRAY') as never,
                sort_order: dto.sortOrder ?? count,
            },
        });
    }

    async updateTimeTag(tenantId: string, id: string, dto: Partial<TimeTagDto>) {
        await this.assertTimeTag(tenantId, id);

        if (dto.name !== undefined) {
            const name = dto.name.trim();
            const clash = await this.db.projectTimeTag.findFirst({
                where: { tenant_id: tenantId, name, id: { not: id } },
                select: { id: true },
            });
            if (clash) throw new ConflictException('A tag with that name already exists.');
        }

        return this.db.projectTimeTag.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.color !== undefined ? { color: dto.color as never } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
        });
    }

    /**
     * Same call as a label: a tag in use is deleted rather than refused, and
     * the count of hours that lose it comes back so the caller can say so.
     * Retiring "Billable" should not mean untagging six months of afternoons
     * first — and the hours themselves are untouched either way.
     */
    async removeTimeTag(tenantId: string, id: string) {
        await this.assertTimeTag(tenantId, id);
        const tagged = await this.db.projectTimeEntryTag.count({
            where: { tenant_id: tenantId, tag_id: id },
        });
        await this.db.projectTimeTag.delete({ where: { id } });
        return { success: true, untagged: tagged };
    }

    private async assertTimeTag(tenantId: string, id: string) {
        const tag = await this.db.projectTimeTag.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true },
        });
        if (!tag) throw new NotFoundException('Tag not found');
        return tag;
    }

    /** Scoped to one board: a project's default column is not the tenant's. */
    private async clearDefault(tenantId: string, projectId?: string) {
        await this.db.projectTaskStatus.updateMany({
            where: { tenant_id: tenantId, project_id: projectId ?? null, is_default: true },
            data: { is_default: false },
        });
    }

    private async assertTaskStatus(tenantId: string, id: string) {
        const status = await this.db.projectTaskStatus.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!status) throw new NotFoundException('Board column not found');
        return status;
    }

    // ── Project types ──────────────────────────────────────────────────────

    async listProjectTypes(tenantId: string, includeInactive = false) {
        return this.db.projectType.findMany({
            where: { tenant_id: tenantId, ...(includeInactive ? {} : { is_active: true }) },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });
    }

    async createProjectType(tenantId: string, dto: CreateProjectTypeDto) {
        const name = dto.name.trim();
        const clash = await this.db.projectType.findFirst({
            where: { tenant_id: tenantId, name },
            select: { id: true },
        });
        if (clash) throw new ConflictException('A project type with that name already exists.');

        const count = await this.db.projectType.count({ where: { tenant_id: tenantId } });
        return this.db.projectType.create({
            data: { tenant_id: tenantId, name, sort_order: dto.sortOrder ?? count },
        });
    }

    async updateProjectType(tenantId: string, id: string, dto: UpdateProjectTypeDto) {
        const type = await this.db.projectType.findFirst({ where: { id, tenant_id: tenantId } });
        if (!type) throw new NotFoundException('Project type not found');

        if (dto.name && dto.name.trim() !== type.name) {
            const clash = await this.db.projectType.findFirst({
                where: { tenant_id: tenantId, name: dto.name.trim(), id: { not: id } },
                select: { id: true },
            });
            if (clash) throw new ConflictException('A project type with that name already exists.');
        }

        return this.db.projectType.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
        });
    }

    /**
     * Deactivates rather than deletes when projects reference the type —
     * deleting would blank the type on historical projects.
     */
    async removeProjectType(tenantId: string, id: string) {
        const type = await this.db.projectType.findFirst({ where: { id, tenant_id: tenantId } });
        if (!type) throw new NotFoundException('Project type not found');

        const inUse = await this.db.project.count({
            where: { tenant_id: tenantId, project_type_id: id, deleted_at: null },
        });
        if (inUse > 0) {
            await this.db.projectType.update({ where: { id }, data: { is_active: false } });
            return { success: true, deactivated: true, projects: inUse };
        }
        await this.db.projectType.delete({ where: { id } });
        return { success: true, deactivated: false };
    }
}
