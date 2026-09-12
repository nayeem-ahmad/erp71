import { TenantRecordScope } from '@erp71/shared-types';
import { ProjectViewer } from './project-access.service';

/**
 * Viewers for the projects specs.
 *
 * `OWNER` is the default stand-in wherever a spec used to pass a bare tenant
 * id: the workspace owner sees every project, so the `where` clauses those
 * specs assert on are exactly what they were before visibility existed. A spec
 * that is actually about visibility uses `staff()` instead, which is filtered.
 */
export const OWNER: ProjectViewer = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    userRole: 'OWNER',
    storeId: 'store-1',
};

export const staff = (userId = 'user-2', tenantId = 'tenant-1'): ProjectViewer => ({
    tenantId,
    userId,
    userRole: 'STAFF',
    storeId: 'store-1',
});

/** The `where` fragment `ProjectAccessService` builds for a non-privileged viewer. */
export const visibilityOr = (userId: string) => [
    { visibility: 'PUBLIC' },
    { manager_id: userId },
    { members: { some: { user_id: userId } } },
];

/**
 * The mock-db slice `ProjectAccessService` needs. Only reached for a viewer who
 * is neither OWNER nor already known to hold VIEW_ALL_PROJECTS.
 */
export const accessDbMock = () => ({
    userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
});

/**
 * A member every one of whose roles is narrowed to their own records —
 * `TenantRole.record_scope = OWN`, resolved onto the request by
 * `TenantInterceptor`. `staff()` is the wide equivalent: same visibility, no
 * record scope, which is what every spec written before the scope existed
 * asserts.
 */
export const narrow = (userId = 'user-2', tenantId = 'tenant-1'): ProjectViewer => ({
    tenantId,
    userId,
    userRole: 'STAFF',
    storeId: 'store-1',
    recordScope: TenantRecordScope.OWN,
});

/** The `OR` the record scope contributes for a task: assigned to them, or raised by them. */
export const ownTaskOr = (userId: string, employeeId: string | null = null) => [
    { assignee_id: userId },
    { created_by: userId },
    ...(employeeId ? [{ assignee_employee_id: employeeId }] : []),
];

/**
 * The employee lookup a narrow viewer's filters make, to match a task assigned
 * to their employee card rather than their login. Only reached on the narrow
 * path, which is why the specs that predate the scope never mock it.
 */
export const attachEmployeeLookup = (db: any, employeeId: string | null = null) => {
    db.employee = {
        ...(db.employee ?? {}),
        findFirst: jest.fn().mockResolvedValue(employeeId ? { id: employeeId } : null),
    };
    return db;
};
