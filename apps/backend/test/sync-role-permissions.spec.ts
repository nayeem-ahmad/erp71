import {
    syncRolePermissions,
    PERMISSION_BACKFILL_GROUPS,
} from '../../../packages/database/prisma/sync-role-permissions';
import { ROLE_DEFAULT_PERMISSIONS, StorePermission, UserRole } from '@erp71/shared-types';

const PROJECT_PERMS = PERMISSION_BACKFILL_GROUPS.find((g) => g.key === 'projects')!.permissions;
const SHORT_LINKS_PERMS = PERMISSION_BACKFILL_GROUPS.find((g) => g.key === 'short-links')!.permissions;
const HR_PERMS = PERMISSION_BACKFILL_GROUPS.find((g) => g.key === 'hr')!.permissions;
/** The subset of a group that MANAGER actually carries in the matrix. */
const managerShare = (perms: StorePermission[]) =>
    perms.filter((perm) => ROLE_DEFAULT_PERMISSIONS[UserRole.MANAGER].includes(perm));

type Row = Record<string, any>;

/**
 * Minimal Prisma stand-in covering exactly the calls the reconciler makes:
 * `findMany` with equality and `{ in: [...] }` filters, and `createMany`.
 */
function fakePrisma(seed: Record<string, Row[]>) {
    const tables: Record<string, Row[]> = {
        tenantRole: [],
        tenantRolePermission: [],
        tenantUser: [],
        userStoreAccess: [],
        userStorePermission: [],
        ...seed,
    };

    const matches = (row: Row, where: Row = {}): boolean =>
        Object.entries(where).every(([key, cond]) =>
            cond && typeof cond === 'object' && 'in' in cond
                ? (cond.in as any[]).includes(row[key])
                : row[key] === cond,
        );

    const model = (name: string) => ({
        findMany: async ({ where }: any = {}) => tables[name].filter((row) => matches(row, where)),
        createMany: async ({ data }: any) => {
            tables[name].push(...data);
            return { count: data.length };
        },
    });

    return {
        client: new Proxy({} as any, { get: (_t, prop: string) => model(prop) }),
        tables,
    };
}

const ROLE_IDS = { manager: 'r-manager', cashier: 'r-cashier', accountant: 'r-accountant' };

function seedTenant(overrides: Partial<Record<string, Row[]>> = {}) {
    return fakePrisma({
        tenantRole: [
            { id: ROLE_IDS.manager, tenant_id: 't1', name: 'Manager', is_system: true },
            { id: ROLE_IDS.cashier, tenant_id: 't1', name: 'Cashier', is_system: true },
            { id: ROLE_IDS.accountant, tenant_id: 't1', name: 'Accountant', is_system: true },
        ],
        tenantUser: [
            { user_id: 'u-mgr', tenant_id: 't1', tenant_role_id: ROLE_IDS.manager },
            { user_id: 'u-cash', tenant_id: 't1', tenant_role_id: ROLE_IDS.cashier },
        ],
        userStoreAccess: [
            { user_id: 'u-mgr', store_id: 's1', tenant_id: 't1' },
            { user_id: 'u-mgr', store_id: 's2', tenant_id: 't1' },
            { user_id: 'u-cash', store_id: 's1', tenant_id: 't1' },
        ],
        ...overrides,
    } as Record<string, Row[]>);
}

describe('syncRolePermissions', () => {
    it('grants the projects group to the roles ROLE_DEFAULT_PERMISSIONS assigns it to', async () => {
        const { client, tables } = seedTenant();

        const [result] = await syncRolePermissions(client);

        // Only MANAGER carries projects permissions in the matrix; cashier and
        // accountant carry none, so only one role is touched.
        expect(ROLE_DEFAULT_PERMISSIONS[UserRole.MANAGER]).toEqual(
            expect.arrayContaining(PROJECT_PERMS),
        );
        expect(result.rolesTouched).toBe(1);
        expect(result.roleGrants).toBe(PROJECT_PERMS.length);
        // The table holds every group's grants, not just this one's — short-links
        // and hr also write to it in the same run.
        expect(
            tables.tenantRolePermission
                .map((r) => r.permission)
                .filter((perm) => PROJECT_PERMS.includes(perm))
                .sort(),
        ).toEqual([...PROJECT_PERMS].sort());
        expect(tables.tenantRolePermission.every((r) => r.tenant_role_id === ROLE_IDS.manager)).toBe(true);
    });

    it('also backfills the short-links group in the same run', async () => {
        const { client, tables } = seedTenant();

        const results = await syncRolePermissions(client);
        // Found by key, not position — another group landing later must not
        // silently break this by shifting array indices.
        const shortLinks = results.find((r) => r.key === 'short-links')!;

        expect(shortLinks.rolesTouched).toBe(1);
        expect(shortLinks.roleGrants).toBe(SHORT_LINKS_PERMS.length);
        expect(
            tables.tenantRolePermission
                .filter((r) => (SHORT_LINKS_PERMS as string[]).includes(r.permission))
                .map((r) => r.permission),
        ).toEqual(SHORT_LINKS_PERMS);
    });

    it('carries VIEW_HR to existing managers but never VIEW_PAYROLL', async () => {
        const { client, tables } = seedTenant();

        const results = await syncRolePermissions(client);
        const hr = results.find((r) => r.key === 'hr')!;

        const granted = tables.tenantRolePermission
            .filter((r) => HR_PERMS.includes(r.permission))
            .map((r) => r.permission);

        // VIEW_PAYROLL is in the group so the "already reconciled" test stays
        // honest, but it is in no role's defaults except OWNER's — and OWNER
        // bypasses the guard entirely rather than holding grants.
        expect(granted).toEqual([StorePermission.VIEW_HR]);
        expect(hr.rolesTouched).toBe(1);
        expect(hr.roleGrants).toBe(managerShare(HR_PERMS).length);
    });

    it('leaves the HR group alone once a role holds any of it', async () => {
        // An owner granted VIEW_PAYROLL by hand. VIEW_HR must not then arrive
        // behind their back on the next deploy.
        const { client, tables } = seedTenant({
            tenantRolePermission: [
                { tenant_role_id: ROLE_IDS.manager, permission: StorePermission.VIEW_PAYROLL },
            ],
        });

        const results = await syncRolePermissions(client);
        const hr = results.find((r) => r.key === 'hr')!;

        expect(hr.roleGrants).toBe(0);
        expect(hr.rolesAlreadyReconciled).toBe(1);
        expect(tables.tenantRolePermission.filter((r) => r.permission === StorePermission.VIEW_HR)).toHaveLength(0);
    });

    it('materializes onto every store the role-holding member can access', async () => {
        const { client, tables } = seedTenant();

        const [result] = await syncRolePermissions(client);

        // The manager holds the role and has two stores; the cashier's role gained
        // nothing, so the cashier gets nothing.
        expect(result.memberGrants).toBe(PROJECT_PERMS.length * 2);
        expect(tables.userStorePermission.every((r) => r.user_id === 'u-mgr')).toBe(true);
        expect(new Set(tables.userStorePermission.map((r) => r.store_id))).toEqual(new Set(['s1', 's2']));
    });

    it('writes nothing on a dry run but reports what it would do', async () => {
        const { client, tables } = seedTenant();

        const [result] = await syncRolePermissions(client, { dryRun: true });

        expect(result.roleGrants).toBe(PROJECT_PERMS.length);
        expect(result.memberGrants).toBe(PROJECT_PERMS.length * 2);
        expect(tables.tenantRolePermission).toHaveLength(0);
        expect(tables.userStorePermission).toHaveLength(0);
    });

    it('is a no-op once the group has landed', async () => {
        const { client } = seedTenant();

        await syncRolePermissions(client);
        const [second] = await syncRolePermissions(client);

        expect(second.roleGrants).toBe(0);
        expect(second.memberGrants).toBe(0);
        expect(second.rolesAlreadyReconciled).toBe(1);
    });

    it('does not re-grant a permission an owner removed after the group landed', async () => {
        // The role keeps the rest of the group, which is the signal that the group
        // already reached it — so the gap is a deliberate removal, not a backlog.
        const { client, tables } = seedTenant({
            tenantRolePermission: PROJECT_PERMS
                .filter((p) => p !== StorePermission.MANAGE_SPRINTS)
                .map((permission) => ({ tenant_role_id: ROLE_IDS.manager, permission })),
        });

        const [result] = await syncRolePermissions(client);

        expect(result.roleGrants).toBe(0);
        expect(result.rolesAlreadyReconciled).toBe(1);
        expect(tables.tenantRolePermission.map((r) => r.permission)).not.toContain(
            StorePermission.MANAGE_SPRINTS,
        );
    });

    it('skips a renamed system role instead of reconciling it as a cashier', async () => {
        const { client, tables } = seedTenant({
            tenantRole: [{ id: ROLE_IDS.manager, tenant_id: 't1', name: 'Branch Lead', is_system: true }],
        });

        const [result] = await syncRolePermissions(client);

        expect(result.rolesUnmapped).toBe(1);
        expect(result.roleGrants).toBe(0);
        expect(tables.tenantRolePermission).toHaveLength(0);
    });

    it('never touches a custom (non-system) role', async () => {
        const { client, tables } = seedTenant({
            tenantRole: [{ id: 'r-custom', tenant_id: 't1', name: 'Manager', is_system: false }],
        });

        const [result] = await syncRolePermissions(client);

        expect(result.roleGrants).toBe(0);
        expect(tables.tenantRolePermission).toHaveLength(0);
    });

    it('only grants within the tenant that owns the role', async () => {
        // The same user belongs to a second tenant; that tenant's stores must not
        // pick up a permission granted through the first tenant's role.
        const { client, tables } = seedTenant({
            userStoreAccess: [
                { user_id: 'u-mgr', store_id: 's1', tenant_id: 't1' },
                { user_id: 'u-mgr', store_id: 's-other', tenant_id: 't2' },
            ],
        });

        await syncRolePermissions(client);

        expect(tables.userStorePermission.every((r) => r.tenant_id === 't1')).toBe(true);
        expect(tables.userStorePermission.map((r) => r.store_id)).not.toContain('s-other');
    });
});
