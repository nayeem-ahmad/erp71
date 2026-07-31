import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    CreateProjectTypeDto,
    CreateTaskStatusDto,
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

    async listTaskStatuses(tenantId: string, includeInactive = false) {
        const existing = await this.db.projectTaskStatus.findMany({
            where: { tenant_id: tenantId, ...(includeInactive ? {} : { is_active: true }) },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        });
        if (existing.length > 0) return existing;

        await this.seedDefaults(tenantId);
        return this.db.projectTaskStatus.findMany({
            where: { tenant_id: tenantId, ...(includeInactive ? {} : { is_active: true }) },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        });
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
    async defaultTaskStatus(tenantId: string) {
        const statuses = await this.listTaskStatuses(tenantId, false);
        if (statuses.length === 0) throw new BadRequestException('No board columns are configured.');
        return statuses.find((s) => s.is_default) ?? statuses[0];
    }

    async createTaskStatus(tenantId: string, dto: CreateTaskStatusDto) {
        await this.listTaskStatuses(tenantId, true);
        const name = dto.name.trim();
        const clash = await this.db.projectTaskStatus.findFirst({
            where: { tenant_id: tenantId, name },
            select: { id: true },
        });
        if (clash) throw new ConflictException('A column with that name already exists.');

        if (dto.isDefault) await this.clearDefault(tenantId);
        const count = await this.db.projectTaskStatus.count({ where: { tenant_id: tenantId } });
        return this.db.projectTaskStatus.create({
            data: {
                tenant_id: tenantId,
                name,
                category: dto.category as never,
                sort_order: dto.sortOrder ?? count,
                is_default: dto.isDefault ?? false,
            },
        });
    }

    async updateTaskStatus(tenantId: string, id: string, dto: UpdateTaskStatusDto) {
        const status = await this.assertTaskStatus(tenantId, id);

        if (dto.name && dto.name.trim() !== status.name) {
            const clash = await this.db.projectTaskStatus.findFirst({
                where: { tenant_id: tenantId, name: dto.name.trim(), id: { not: id } },
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

        if (dto.isDefault) await this.clearDefault(tenantId);

        return this.db.projectTaskStatus.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.category !== undefined ? { category: dto.category as never } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
                ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
                ...(dto.isDefault !== undefined ? { is_default: dto.isDefault } : {}),
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

    private async clearDefault(tenantId: string) {
        await this.db.projectTaskStatus.updateMany({
            where: { tenant_id: tenantId, is_default: true },
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
