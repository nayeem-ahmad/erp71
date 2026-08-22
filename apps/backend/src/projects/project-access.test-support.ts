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
