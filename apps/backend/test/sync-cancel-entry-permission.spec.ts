import { syncCancelEntryPermission } from '../../../packages/database/prisma/sync-cancel-entry-permission';
import { StorePermission, TENANT_ROLE_TEMPLATES } from '@erp71/shared-types';

const PERMISSION = StorePermission.CANCEL_ENTRY;

type Row = Record<string, any>;

/**
 * Minimal Prisma stand-in covering exactly the calls the reconciler makes:
 * `findMany` with equality and `{ in: [...] }` filters, and `createMany`.
 * Mirrors the one in `sync-role-permissions.spec.ts`.
 */
function fakePrisma(seed: Record<string, Row[]>) {
    const tables: Record<string, Row[]> = {
        tenantRole: [],
        tenantRolePermission: [],
        tenantUserRole: [],
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

function seedTenant(overrides: Partial<Record<string, Row[]>> = {}) {
    return fakePrisma({
        tenantRole: [
            // Matched on template_key, not name — an owner may have renamed
            // their copy, and it is still the Tenant Admin role.
            { id: 'r-admin', tenant_id: 't1', name: 'Workspace Admin', is_system: true, template_key: 'tenant_admin' },
            { id: 'r-sales-mgr', tenant_id: 't1', name: 'Sales Manager', is_system: true, template_key: 'sales_manager' },
            { id: 'r-manager', tenant_id: 't1', name: 'Manager', is_system: true, template_key: null },
        ],
        // Read through the join table: Tenant Admin may be any of a member's
        // roles rather than their primary one.
        tenantUserRole: [
            { tenant_role_id: 'r-admin', tenantUser: { user_id: 'u-admin', tenant_id: 't1' } },
            { tenant_role_id: 'r-sales-mgr', tenantUser: { user_id: 'u-sales', tenant_id: 't1' } },
        ],
        userStoreAccess: [
            { user_id: 'u-admin', store_id: 's1', tenant_id: 't1' },
            { user_id: 'u-admin', store_id: 's2', tenant_id: 't1' },
            { user_id: 'u-sales', store_id: 's1', tenant_id: 't1' },
        ],
        ...overrides,
    } as Record<string, Row[]>);
}

describe('syncCancelEntryPermission', () => {
    it('is the permission the Tenant Admin template already carries', () => {
        const admin = TENANT_ROLE_TEMPLATES.find((template) => template.key === 'tenant_admin')!;
        expect(admin.permissions).toContain(PERMISSION);

        // And no module role does — cancelling reverses stock, party balances
        // and the ledger, so it must not ride along with a CREATE_* grant.
        const moduleRoles = TENANT_ROLE_TEMPLATES.filter((template) => template.key !== 'tenant_admin');
        for (const role of moduleRoles) {
            expect(role.permissions).not.toContain(PERMISSION);
        }
    });

    it('grants the permission to the Tenant Admin role and to every store its holders reach', async () => {
        const { client, tables } = seedTenant();

        const result = await syncCancelEntryPermission(client);

        expect(result).toEqual({ roleGrants: 1, memberGrants: 2 });
        expect(tables.tenantRolePermission).toEqual([
            { tenant_role_id: 'r-admin', permission: PERMISSION },
        ]);
        expect(tables.userStorePermission).toEqual([
            expect.objectContaining({ user_id: 'u-admin', store_id: 's1', tenant_id: 't1', permission: PERMISSION }),
            expect.objectContaining({ user_id: 'u-admin', store_id: 's2', tenant_id: 't1', permission: PERMISSION }),
        ]);
    });

    it('leaves module roles and their members alone', async () => {
        const { client, tables } = seedTenant();

        await syncCancelEntryPermission(client);

        expect(tables.tenantRolePermission.map((row) => row.tenant_role_id)).not.toContain('r-sales-mgr');
        expect(tables.userStorePermission.map((row) => row.user_id)).not.toContain('u-sales');
    });

    it('is a no-op on a second run', async () => {
        const { client, tables } = seedTenant();

        await syncCancelEntryPermission(client);
        const second = await syncCancelEntryPermission(client);

        expect(second).toEqual({ roleGrants: 0, memberGrants: 0 });
        expect(tables.tenantRolePermission).toHaveLength(1);
        expect(tables.userStorePermission).toHaveLength(2);
    });

    it('does not re-grant a permission an owner deliberately removed from the role', async () => {
        const { client, tables } = seedTenant({
            tenantRolePermission: [{ tenant_role_id: 'r-admin', permission: PERMISSION }],
        });

        const result = await syncCancelEntryPermission(client);

        expect(result.roleGrants).toBe(0);
        expect(tables.tenantRolePermission).toHaveLength(1);
    });

    it('writes nothing on a dry run', async () => {
        const { client, tables } = seedTenant();

        const result = await syncCancelEntryPermission(client, { dryRun: true });

        expect(result).toEqual({ roleGrants: 1, memberGrants: 2 });
        expect(tables.tenantRolePermission).toHaveLength(0);
        expect(tables.userStorePermission).toHaveLength(0);
    });

    it('only touches stores in the tenant that granted the role', async () => {
        const { client, tables } = seedTenant({
            userStoreAccess: [
                { user_id: 'u-admin', store_id: 's1', tenant_id: 't1' },
                // The same person, admin of one workspace, cashier in another.
                { user_id: 'u-admin', store_id: 's9', tenant_id: 't2' },
            ],
        });

        await syncCancelEntryPermission(client);

        expect(tables.userStorePermission.map((row) => row.store_id)).toEqual(['s1']);
    });

    it('does nothing for a workspace that has no Tenant Admin role yet', async () => {
        const { client, tables } = fakePrisma({
            tenantRole: [
                { id: 'r-manager', tenant_id: 't1', name: 'Manager', is_system: true, template_key: null },
            ],
        });

        expect(await syncCancelEntryPermission(client)).toEqual({ roleGrants: 0, memberGrants: 0 });
        expect(tables.tenantRolePermission).toHaveLength(0);
    });
});
