import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePermission, TenantRecordScope } from '@erp71/shared-types';
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
    /** The workspace's IANA zone, for calendar-day filters. Optional here so a
     *  caller assembling a viewer by hand (tests, sweeps) need not supply one. */
    timezone?: string;
    /**
     * How much of the module's data this viewer reads — `TenantContext` carries
     * it, resolved once per request by `TenantInterceptor` as the widest scope
     * across the roles they hold.
     *
     * Optional, and absent means `ALL`: a viewer assembled by hand (a sweep, a
     * scheduler, a spec) is the system rather than a person, and the system is
     * not narrowed. Every HTTP path has it, because `@Tenant()` throws when the
     * interceptor has not run.
     */
    recordScope?: TenantRecordScope;
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
 *
 * Record scope
 * ------------
 * Visibility answers "which projects", and `TenantRole.record_scope` answers
 * "which rows inside them". A member every one of whose roles says `OWN` reads
 * only the rows they are on — the tasks assigned to or raised by them, the
 * hours they logged — and the two filters compose: narrow scope never widens
 * what visibility allows, and visibility never widens what scope allows.
 *
 * Scope is deliberately the *second* axis rather than a third project
 * visibility: it is a property of the person, not of the project, so the same
 * project reads differently for a project manager and for the contributor
 * working one task on it.
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
     * Whether this viewer reads only the rows they are on.
     *
     * The scope itself is resolved upstream, once per request, by
     * `TenantInterceptor` — widest-wins across the roles the member holds, so
     * one unrestricted role is enough to make them wide and "give them Project
     * Manager as well" widens them rather than leaving them stuck. Reading it
     * off the viewer rather than re-querying keeps the filters below free of a
     * per-call lookup, and keeps the answer identical for every surface within
     * one request.
     *
     * OWNER is never narrow — they bypass every permission check in the app, so
     * a restriction they could not lift would be the only one of its kind.
     * A viewer with no scope at all is the system (a sweep, a scheduler), and
     * the system is not narrowed either.
     */
    ownRecordsOnly(viewer: ProjectViewer): boolean {
        if (viewer.userRole === 'OWNER') return false;
        if (!viewer.userId) return false;
        return viewer.recordScope === TenantRecordScope.OWN;
    }

    /**
     * The employee record this login is attached to, if any.
     *
     * Assignment mirrors `ProjectMember`: a task goes to a User *or* to an
     * Employee who has no login (see `ProjectTask`). Someone who has both — a
     * staff member with an ERP account — can therefore hold tasks under either
     * column, so "my tasks" has to ask about both or half of their work
     * disappears the day somebody assigns it to their employee card.
     */
    private async viewerEmployeeId(viewer: ProjectViewer): Promise<string | null> {
        if (!viewer.userId) return null;
        const employee = await this.db.employee.findFirst({
            where: { tenant_id: viewer.tenantId, user_id: viewer.userId },
            select: { id: true },
        });
        return employee?.id ?? null;
    }

    /**
     * A `where` fragment for the `project_tasks` table: project visibility, plus
     * the record scope when the viewer is narrow.
     *
     * Own means assigned to them under either assignee column, **or** raised by
     * them. `created_by` is in the predicate because a task nobody has assigned
     * yet would otherwise vanish the moment it was saved — the one thing a
     * contributor must never lose sight of is the task they just wrote.
     *
     * Returns `{}` or a single `AND`, the same shape `relatedFilter` returns, so
     * it is safe both to spread into a `where` that has no `AND` of its own and
     * to hand to `merge()`.
     */
    async taskFilter(viewer: ProjectViewer): Promise<Record<string, unknown>> {
        const visibility = await this.relatedFilter(viewer);
        if (!this.ownRecordsOnly(viewer)) return visibility;

        const employeeId = await this.viewerEmployeeId(viewer);
        const own = {
            OR: [
                { assignee_id: viewer.userId },
                { created_by: viewer.userId },
                ...(employeeId ? [{ assignee_employee_id: employeeId }] : []),
            ],
        };
        return ProjectAccessService.merge(visibility, { AND: [own] });
    }

    /**
     * The task fragment nested under `task`, for a row addressed by its own id
     * with no task in the route — checklist items, attachments, board cards.
     * `{}` stays `{}` so the unrestricted path adds no clause.
     */
    async taskRelatedFilter(viewer: ProjectViewer): Promise<Record<string, unknown>> {
        const filter = await this.taskFilter(viewer);
        if (Object.keys(filter).length === 0) return {};
        return { AND: [{ task: filter }] };
    }

    /**
     * A `where` fragment for the `project_time_entries` table.
     *
     * An hour log belongs to exactly one person, so narrow scope is a plain
     * equality rather than the OR the tasks need. The employee column is in
     * there for the same reason as on a task: an entry costed against somebody's
     * employee card is still their afternoon.
     */
    async timeFilter(viewer: ProjectViewer): Promise<Record<string, unknown>> {
        const visibility = await this.relatedFilter(viewer);
        if (!this.ownRecordsOnly(viewer)) return visibility;

        const employeeId = await this.viewerEmployeeId(viewer);
        const own = employeeId
            ? { OR: [{ user_id: viewer.userId }, { employee_id: employeeId }] }
            : { user_id: viewer.userId };
        return ProjectAccessService.merge(visibility, { AND: [own] });
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

    /**
     * Same check, reached through a task — visibility *and* record scope, since
     * this is the gate every single-task route resolves through. Returns the
     * task's project id.
     */
    async assertTaskVisible(viewer: ProjectViewer, taskId: string): Promise<string> {
        const filter = await this.taskFilter(viewer);
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
