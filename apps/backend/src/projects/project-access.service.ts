import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

/**
 * Who is asking. `TenantContext` satisfies this structurally, so a controller
 * passes `@Tenant() tenant` straight through and nothing has to be unpacked.
 */
export interface ProjectViewer {
    tenantId: string;
    userId: string;
    userRole?: string;
    storeId?: string;
}

/**
 * Project visibility.
 *
 * `VIEW_PROJECTS` answers "may this user open the Projects module at all". It
 * cannot answer "may they see *this* project", because that depends on the
 * project rather than on the user — so visibility is a second filter layered on
 * top of the permission guard, applied in the services rather than in a guard.
 *
 * The rule: a PUBLIC project is visible to every user in the tenant who holds
 * `VIEW_PROJECTS`. A PRIVATE project is visible to its members, its manager,
 * the workspace OWNER, and anyone granted `VIEW_ALL_PROJECTS`.
 *
 * The manager is in the predicate rather than relying on a member row so a
 * project can never end up invisible to the person accountable for it — a
 * member row can be deleted, `manager_id` is a field on the project itself.
 * `created_by` deliberately is *not*: whoever set a project up should lose sight
 * of it once they are taken off it, otherwise "remove them from the project"
 * silently does nothing.
 *
 * Everything hanging off a project inherits its visibility — tasks, hours,
 * comments, attachments, board cards, sprint rollups. A private project whose
 * tasks still showed up on the cross-project Tasks page would not be private.
 */
@Injectable()
export class ProjectAccessService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * OWNER, or a `VIEW_ALL_PROJECTS` grant on the active store. Mirrors
     * `StorePermissionGuard`, which also treats OWNER as holding everything.
     */
    async seesEveryProject(viewer: ProjectViewer): Promise<boolean> {
        if (viewer.userRole === 'OWNER') return true;
        if (!viewer.storeId || !viewer.userId) return false;

        const grant = await this.db.userStorePermission.findFirst({
            where: {
                user_id: viewer.userId,
                store_id: viewer.storeId,
                permission: StorePermission.VIEW_ALL_PROJECTS as never,
            },
            select: { id: true },
        });
        return Boolean(grant);
    }

    /**
     * A `where` fragment for the `projects` table. `{}` when the viewer sees
     * everything, so the common owner/admin path adds no clause at all.
     *
     * Combine it with `merge()` rather than spreading it into a `where` that
     * may already carry an `OR`: this contributes an `OR` of its own, and a
     * second `OR` key on the same object silently replaces the first. Spreading
     * is only safe where the caller's `where` provably has none.
     */
    async projectFilter(viewer: ProjectViewer): Promise<Record<string, unknown>> {
        if (await this.seesEveryProject(viewer)) return {};
        return {
            OR: [
                { visibility: 'PUBLIC' },
                { manager_id: viewer.userId },
                { members: { some: { user_id: viewer.userId } } },
            ],
        };
    }

    /**
     * The same fragment nested under `project`, for any row that points at one —
     * tasks, time entries, board cards. Nested in an `AND` so it cannot collide
     * with a `project` key the caller already set.
     */
    async relatedFilter(viewer: ProjectViewer): Promise<Record<string, unknown>> {
        const filter = await this.projectFilter(viewer);
        if (Object.keys(filter).length === 0) return {};
        return { AND: [{ project: filter }] };
    }

    /**
     * Combines a caller's `where` with the visibility filter without either one
     * clobbering the other's `OR`/`AND`. An empty filter is returned unchanged,
     * so the owner path adds no clause.
     *
     * A fragment that is itself just an `AND` (what `relatedFilter` returns) is
     * spliced in rather than nested, so the resulting clause reads the same
     * whichever of the two filters it came from.
     */
    static merge(
        where: Record<string, unknown>,
        filter: Record<string, unknown>,
    ): Record<string, unknown> {
        if (Object.keys(filter).length === 0) return where;
        const incoming =
            Object.keys(filter).length === 1 && Array.isArray(filter.AND)
                ? (filter.AND as unknown[])
                : [filter];
        const existing = Array.isArray(where.AND) ? (where.AND as unknown[]) : where.AND ? [where.AND] : [];
        return { ...where, AND: [...existing, ...incoming] };
    }

    /**
     * Throws when the project is invisible to the viewer.
     *
     * `NotFoundException`, never `ForbiddenException`: "you may not see this
     * project" confirms the project exists, which is exactly what a private
     * project should not do. It is also what a caller passing an id from another
     * tenant already gets, so the two cases stay indistinguishable.
     */
    async assertProjectVisible(viewer: ProjectViewer, projectId: string) {
        const filter = await this.projectFilter(viewer);
        const project = await this.db.project.findFirst({
            where: {
                id: projectId,
                tenant_id: viewer.tenantId,
                deleted_at: null,
                ...filter,
            } as never,
            select: { id: true, visibility: true, manager_id: true },
        });
        if (!project) throw new NotFoundException('Project not found');
        return project;
    }

    /** Same check, reached through a task. Returns the task's project id. */
    async assertTaskVisible(viewer: ProjectViewer, taskId: string): Promise<string> {
        const filter = await this.relatedFilter(viewer);
        const task = await this.db.projectTask.findFirst({
            where: {
                id: taskId,
                tenant_id: viewer.tenantId,
                deleted_at: null,
                ...filter,
            } as never,
            select: { project_id: true },
        });
        if (!task) throw new NotFoundException('Task not found');
        return task.project_id;
    }

    /**
     * The member rows a private project needs to make sense of itself. Called
     * when a project becomes private, so its manager and creator appear in the
     * team list rather than having invisible access through the predicate.
     *
     * Employees without a login are left alone — they cannot log in to be
     * blocked in the first place.
     */
    async seedPrivateMembers(tenantId: string, projectId: string, userIds: (string | null | undefined)[]) {
        const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
        for (const userId of unique) {
            await this.db.projectMember.upsert({
                where: { project_id_user_id: { project_id: projectId, user_id: userId } } as never,
                create: { tenant_id: tenantId, project_id: projectId, user_id: userId, role: 'MANAGER' as never },
                // Never demotes or promotes an existing row: the point is that
                // a row exists, not what it says.
                update: {},
            });
        }
    }
}
