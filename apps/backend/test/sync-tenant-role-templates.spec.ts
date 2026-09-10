import { syncTenantRoleTemplates } from '../../../packages/database/prisma/sync-tenant-role-templates';
import { seedDefaultTenantRoles } from '../../../packages/database/prisma/tenant-role.seed';
import { TENANT_ROLE_TEMPLATES } from '@erp71/shared-types';

type Row = Record<string, any>;

/**
 * Minimal Prisma stand-in covering the calls the template sync makes: `findMany`
 * with equality, `{ in: [...] }` and `{ not: null }` filters plus the
 * `roles: { none: {} }` relation filter, `create` and `createMany`.
 */
function fakePrisma(seed: Record<string, Row[]> = {}) {
    const tables: Record<string, Row[]> = {
        tenant: [],
        tenantRole: [],
        tenantRolePermission: [],
        tenantUser: [],
        tenantUserRole: [],
        userInvitation: [],
        userInvitationRole: [],
        ...seed,
    };
    let nextId = 0;

    // `roles: { none: {} }` is the one relation filter the sync uses; it means
    // "this row has no join rows yet", which is the whole point of the backfill.
    const hasNoJoinRows = (name: string, row: Row) =>
        name === 'tenantUser'
            ? !tables.tenantUserRole.some((join) => join.tenant_user_id === row.id)
            : !tables.userInvitationRole.some((join) => join.invitation_id === row.id);

    const matches = (name: string, row: Row, where: Row = {}): boolean =>
        Object.entries(where).every(([key, cond]) => {
            if (key === 'roles') return hasNoJoinRows(name, row);
            if (cond && typeof cond === 'object' && 'in' in cond) return (cond.in as any[]).includes(row[key]);
            if (cond && typeof cond === 'object' && 'not' in cond) {
                return (cond as any).not === null ? row[key] != null : row[key] !== (cond as any).not;
            }
            return row[key] === cond;
        });

    const model = (name: string) => ({
        findMany: async ({ where }: any = {}) => tables[name].filter((row) => matches(name, row, where)),
        create: async ({ data }: any) => {
            const row = { id: `${name}-${++nextId}`, ...data };
            tables[name].push(row);
            return row;
        },
        createMany: async ({ data }: any) => {
            tables[name].push(...data);
            return { count: data.length };
        },
    });

    return { client: new Proxy({} as any, { get: (_t, prop: string) => model(prop) }), tables };
}

describe('syncTenantRoleTemplates', () => {
    it('creates every template for a tenant that has none of them', async () => {
        const { client, tables } = fakePrisma({ tenant: [{ id: 't1' }] });

        const result = await syncTenantRoleTemplates(client);

        expect(result.rolesCreated).toBe(TENANT_ROLE_TEMPLATES.length);
        expect(tables.tenantRole).toHaveLength(TENANT_ROLE_TEMPLATES.length);
        expect(tables.tenantRole.map((r) => r.template_key).sort()).toEqual(
            TENANT_ROLE_TEMPLATES.map((tpl) => tpl.key).sort(),
        );
        expect(tables.tenantRolePermission).toHaveLength(
            TENANT_ROLE_TEMPLATES.reduce((sum, tpl) => sum + tpl.permissions.length, 0),
        );
    });

    it('is idempotent — a second run creates nothing', async () => {
        const { client, tables } = fakePrisma({ tenant: [{ id: 't1' }] });

        await syncTenantRoleTemplates(client);
        const before = tables.tenantRole.length;
        const second = await syncTenantRoleTemplates(client);

        expect(second.rolesCreated).toBe(0);
        expect(tables.tenantRole).toHaveLength(before);
    });

    it('finds a renamed copy by template_key rather than creating a duplicate', async () => {
        const { client, tables } = fakePrisma({
            tenant: [{ id: 't1' }],
            tenantRole: [
                { id: 'r1', tenant_id: 't1', name: 'Shop Floor Lead', is_system: true, template_key: 'sales_manager' },
            ],
        });

        await syncTenantRoleTemplates(client);

        expect(tables.tenantRole.filter((r) => r.template_key === 'sales_manager')).toHaveLength(1);
        expect(tables.tenantRole.find((r) => r.template_key === 'sales_manager')!.name).toBe('Shop Floor Lead');
    });

    it('leaves an existing template role untouched instead of re-permissioning it', async () => {
        // An owner may have removed a permission on purpose; the absence of a row
        // cannot be told apart from "the template gained it later", so nothing is
        // reconciled onto a role that already exists.
        const { client, tables } = fakePrisma({
            tenant: [{ id: 't1' }],
            tenantRole: [
                { id: 'r1', tenant_id: 't1', name: 'Sales Manager', is_system: true, template_key: 'sales_manager' },
            ],
        });

        await syncTenantRoleTemplates(client);

        expect(tables.tenantRolePermission.filter((p) => p.tenant_role_id === 'r1')).toHaveLength(0);
    });

    it('skips a template whose name a hand-written role already occupies', async () => {
        // TenantRole is unique on (tenant, name) — creating it would throw, and the
        // owner's own role must not be touched either way.
        const { client, tables } = fakePrisma({
            tenant: [{ id: 't1' }],
            tenantRole: [
                { id: 'r1', tenant_id: 't1', name: 'Sales Manager', is_system: false, template_key: null },
            ],
        });

        const result = await syncTenantRoleTemplates(client);

        expect(result.nameCollisions).toBe(1);
        expect(result.rolesCreated).toBe(TENANT_ROLE_TEMPLATES.length - 1);
        expect(tables.tenantRole.filter((r) => r.name === 'Sales Manager')).toHaveLength(1);
    });

    it('backfills the role set of a member who predates multi-role', async () => {
        const { client, tables } = fakePrisma({
            tenant: [{ id: 't1' }],
            tenantUser: [{ id: 'tu1', tenant_id: 't1', tenant_role_id: 'r-cashier' }],
        });

        const result = await syncTenantRoleTemplates(client);

        expect(result.memberRolesBackfilled).toBe(1);
        expect(tables.tenantUserRole).toEqual([
            { tenant_user_id: 'tu1', tenant_role_id: 'r-cashier' },
        ]);
    });

    it('leaves a member who already has a role set alone', async () => {
        const { client, tables } = fakePrisma({
            tenant: [{ id: 't1' }],
            tenantUser: [{ id: 'tu1', tenant_id: 't1', tenant_role_id: 'r-cashier' }],
            tenantUserRole: [{ tenant_user_id: 'tu1', tenant_role_id: 'r-sales' }],
        });

        const result = await syncTenantRoleTemplates(client);

        expect(result.memberRolesBackfilled).toBe(0);
        expect(tables.tenantUserRole).toHaveLength(1);
    });

    it('backfills pending invitations but not accepted ones', async () => {
        const { client, tables } = fakePrisma({
            tenant: [{ id: 't1' }],
            userInvitation: [
                { id: 'inv1', tenant_role_id: 'r-cashier', accepted_at: null },
                { id: 'inv2', tenant_role_id: 'r-cashier', accepted_at: new Date() },
            ],
        });

        const result = await syncTenantRoleTemplates(client);

        expect(result.invitationRolesBackfilled).toBe(1);
        expect(tables.userInvitationRole).toEqual([
            { invitation_id: 'inv1', tenant_role_id: 'r-cashier' },
        ]);
    });

    it('writes nothing on a dry run', async () => {
        const { client, tables } = fakePrisma({
            tenant: [{ id: 't1' }],
            tenantUser: [{ id: 'tu1', tenant_id: 't1', tenant_role_id: 'r-cashier' }],
        });

        const result = await syncTenantRoleTemplates(client, { dryRun: true });

        expect(result.rolesCreated).toBe(TENANT_ROLE_TEMPLATES.length);
        expect(result.memberRolesBackfilled).toBe(1);
        expect(tables.tenantRole).toHaveLength(0);
        expect(tables.tenantUserRole).toHaveLength(0);
    });
});

describe('seedDefaultTenantRoles', () => {
    it('creates the three legacy roles plus every template', async () => {
        const { client, tables } = fakePrisma();

        const ids = await seedDefaultTenantRoles(client, 't1');

        expect(tables.tenantRole).toHaveLength(3 + TENANT_ROLE_TEMPLATES.length);
        // The demo seed asks for these three by key — the shape must not change.
        expect(ids.manager).toBeDefined();
        expect(ids.cashier).toBeDefined();
        expect(ids.accountant).toBeDefined();
        for (const template of TENANT_ROLE_TEMPLATES) {
            expect(ids[template.key]).toBeDefined();
        }
    });

    it('gives every seeded role a unique name, so the (tenant, name) unique holds', async () => {
        const { client, tables } = fakePrisma();

        await seedDefaultTenantRoles(client, 't1');

        const names = tables.tenantRole.map((r) => r.name);
        expect(new Set(names).size).toBe(names.length);
    });
});
