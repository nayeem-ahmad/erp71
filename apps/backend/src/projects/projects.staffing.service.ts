import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { StaffingQueryDto } from './project.dto';
import {
    OVERLOAD_THRESHOLD,
    mergeStaffing,
    parseStaffingStatuses,
    personKey,
    type MergeStaffingInput,
    type StaffingEmployeeRef,
    type StaffingProject,
    type StaffingResponse,
    type StaffingRole,
    type StaffingUserRef,
} from './staffing.util';

const MEMBER_INCLUDE = {
    user: { select: { id: true, name: true, email: true } },
    employee: { select: { id: true, name: true, employee_code: true } },
} as const;

interface GroupedHours {
    project_id: string;
    assignee_id?: string | null;
    assignee_employee_id?: string | null;
    _sum?: { remaining_hours: unknown };
    _count?: { _all: number };
}

/**
 * Loader for `GET /projects/staffing`. Visibility and PROJECT scope come from
 * `ProjectAccessService`; OWN is applied after merge so teammates and Unassigned
 * never leave this service.
 */
@Injectable()
export class ProjectsStaffingService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
    ) {}

    async get(viewer: ProjectViewer, query: StaffingQueryDto): Promise<StaffingResponse> {
        const statuses = parseStaffingStatuses(query.status);
        const filter = await this.access.projectFilter(viewer);
        const rows = await this.db.project.findMany({
            where: ProjectAccessService.merge(
                {
                    tenant_id: viewer.tenantId,
                    deleted_at: null,
                    ...(statuses.length ? { status: { in: statuses } } : {}),
                },
                filter,
            ) as never,
            orderBy: { code: 'asc' },
            select: {
                id: true,
                code: true,
                name: true,
                short_name: true,
                status: true,
                manager_id: true,
                manager: { select: { id: true, name: true, email: true } },
            },
        });

        const projects: StaffingProject[] = rows.map((row) => ({
            id: row.id,
            code: row.code,
            shortName: row.short_name,
            name: row.name,
            status: String(row.status),
        }));

        if (projects.length === 0) return mergeStaffing(emptyInput(projects));

        const projectIds = projects.map((project) => project.id);
        const [members, openStatuses] = await Promise.all([
            this.db.projectMember.findMany({
                where: { tenant_id: viewer.tenantId, project_id: { in: projectIds } },
                include: MEMBER_INCLUDE,
            }),
            this.db.projectTaskStatus.findMany({
                where: { tenant_id: viewer.tenantId, category: { not: 'DONE' } },
                select: { id: true },
            }),
        ]);

        const hours = await this.loadHours(viewer.tenantId, projectIds, openStatuses.map((s) => s.id));
        const { userById, employeeById, linkedEmployees } = await this.lookupPeople(
            viewer,
            members,
            hours,
        );

        const merged = mergeStaffing({
            projects,
            members: members.map((member) => ({
                projectId: member.project_id,
                userId: member.user_id,
                employeeId: member.employee_id,
                role: member.role as StaffingRole,
                user: member.user,
                employee: member.employee,
            })),
            managers: rows.flatMap((row) => {
                if (!row.manager_id) return [];
                return [
                    {
                        projectId: row.id,
                        userId: row.manager_id,
                        name: row.manager?.name ?? null,
                        email: row.manager?.email ?? null,
                    },
                ];
            }),
            hours: hours.map((row) => ({
                ...row,
                user: row.userId ? userById.get(row.userId) ?? null : null,
                employee: row.employeeId ? employeeById.get(row.employeeId) ?? null : null,
            })),
            linkedEmployees,
        });

        return this.access.ownRecordsOnly(viewer)
            ? keepOwn(merged, viewer.userId, linkedEmployees)
            : merged;
    }

    private async loadHours(tenantId: string, projectIds: string[], openStatusIds: string[]) {
        if (openStatusIds.length === 0) return [];

        const taskWhere = {
            tenant_id: tenantId,
            deleted_at: null,
            project_id: { in: projectIds },
            status_id: { in: openStatusIds },
        };

        const [byUser, byEmployee, unassigned] = await Promise.all([
            this.db.projectTask.groupBy({
                by: ['project_id', 'assignee_id'],
                where: { ...taskWhere, assignee_id: { not: null } } as never,
                _sum: { remaining_hours: true },
                _count: { _all: true },
            }),
            this.db.projectTask.groupBy({
                by: ['project_id', 'assignee_employee_id'],
                where: { ...taskWhere, assignee_employee_id: { not: null } } as never,
                _sum: { remaining_hours: true },
                _count: { _all: true },
            }),
            this.db.projectTask.groupBy({
                by: ['project_id'],
                where: { ...taskWhere, assignee_id: null, assignee_employee_id: null } as never,
                _sum: { remaining_hours: true },
                _count: { _all: true },
            }),
        ]);

        return [
            ...byUser.map((row) => hoursRow(row, row.assignee_id, null)),
            ...byEmployee.map((row) => hoursRow(row, null, row.assignee_employee_id)),
            ...unassigned.map((row) => hoursRow(row, null, null)),
        ];
    }

    private async lookupPeople(
        viewer: ProjectViewer,
        members: Array<{ user_id: string | null; employee_id: string | null }>,
        hours: Array<{ userId?: string | null; employeeId?: string | null }>,
    ) {
        const memberUserIds = new Set(compact(members.map((m) => m.user_id)));
        const hoursUserIds = unique(compact(hours.map((h) => h.userId))).filter(
            (id) => !memberUserIds.has(id),
        );
        const employeeIds = unique([
            ...compact(members.map((m) => m.employee_id)),
            ...compact(hours.map((h) => h.employeeId)),
        ]);
        const linkedUserIds = unique([
            viewer.userId,
            ...memberUserIds,
            ...compact(hours.map((h) => h.userId)),
        ]);

        const or: Record<string, unknown>[] = [];
        if (employeeIds.length) or.push({ id: { in: employeeIds } });
        if (linkedUserIds.length) or.push({ user_id: { in: linkedUserIds } });

        const [users, employees] = await Promise.all([
            hoursUserIds.length
                ? this.db.user.findMany({
                      where: { id: { in: hoursUserIds } },
                      select: { id: true, name: true, email: true },
                  })
                : Promise.resolve([]),
            or.length
                ? this.db.employee.findMany({
                      where: { tenant_id: viewer.tenantId, deleted_at: null, OR: or },
                      select: { id: true, name: true, employee_code: true, user_id: true },
                  })
                : Promise.resolve([]),
        ]);

        const userById = new Map<string, StaffingUserRef>(users.map((u) => [u.id, u]));
        const employeeById = new Map<string, StaffingEmployeeRef>(
            employees.map((e) => [e.id, { id: e.id, name: e.name, employee_code: e.employee_code }]),
        );
        const linkedEmployees = employees
            .filter((e): e is typeof e & { user_id: string } => Boolean(e.user_id))
            .map((e) => ({ employeeId: e.id, userId: e.user_id }));

        return { userById, employeeById, linkedEmployees };
    }
}

function emptyInput(projects: StaffingProject[]): MergeStaffingInput {
    return { projects, members: [], managers: [], hours: [], linkedEmployees: [] };
}

function hoursRow(
    row: GroupedHours,
    userId: string | null | undefined,
    employeeId: string | null | undefined,
) {
    return {
        projectId: row.project_id,
        userId: userId ?? null,
        employeeId: employeeId ?? null,
        remainingHours: asNumber(row._sum?.remaining_hours),
        openTasks: asNumber(row._count?._all),
    };
}

function keepOwn(
    response: StaffingResponse,
    userId: string,
    linkedEmployees: Array<{ employeeId: string; userId: string }>,
): StaffingResponse {
    const keep = new Set([personKey('user', userId)]);
    for (const row of linkedEmployees) {
        if (row.userId === userId) keep.add(personKey('employee', row.employeeId));
    }
    const people = response.people.filter((person) => keep.has(person.key));
    const assigned = people.filter((person) => person.kind !== 'unassigned');
    return {
        projects: response.projects,
        people,
        summary: {
            people: assigned.length,
            projects: response.projects.length,
            remainingHours: assigned.reduce((sum, person) => sum + person.totals.remainingHours, 0),
            unassignedRemainingHours: 0,
            unassignedOpenTasks: 0,
            overloaded: assigned.filter((person) => person.totals.projectCount >= OVERLOAD_THRESHOLD).length,
        },
    };
}

function asNumber(value: unknown): number {
    if (value == null) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function compact<T>(values: Array<T | null | undefined>): T[] {
    return values.filter((value): value is T => value != null && value !== '');
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}
