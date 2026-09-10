import {
  ROLE_DEFAULT_PERMISSIONS,
  TENANT_ROLE_TEMPLATES,
  UserRole,
  type StorePermission,
} from '@erp71/shared-types';

/**
* The three roles that predate the module templates. They stay because
* `SYSTEM_TENANT_ROLE_TO_USER_ROLE` maps them to the coarse `TenantUser.role`
* enum by name, `sync-role-permissions.ts` reconciles new permissions onto them
* by that same name, and the demo seed asks for them by key.
*/
const LEGACY_SYSTEM_ROLES: { key: 'manager' | 'cashier' | 'accountant'; name: string; role: UserRole }[] = [
  { key: 'manager', name: 'Manager', role: UserRole.MANAGER },
  { key: 'cashier', name: 'Cashier', role: UserRole.CASHIER },
  { key: 'accountant', name: 'Accountant', role: UserRole.ACCOUNTANT },
];

/**
* Every role a new tenant starts with: the three legacy roles above plus one
* copy of each `TENANT_ROLE_TEMPLATES` entry — a manager and a user role per
* module, and the administration roles.
*
* They are real, tenant-owned `TenantRole` rows, not references to the template:
* an owner can rename, re-permission or delete their copy without it changing
* for anybody else. `template_key` is what lets a later sync still find the copy
* after a rename (see `sync-tenant-role-templates.ts`).
*
* Returns role ids keyed by legacy key and by template key, so a caller that
* wants to assign one straight away — the demo seed does — need not re-query.
*/
export async function seedDefaultTenantRoles(tx: any, tenantId: string) {
  const ids: Record<string, string> = {};

  for (const entry of LEGACY_SYSTEM_ROLES) {
    const role = await tx.tenantRole.create({
      data: { tenant_id: tenantId, name: entry.name, is_system: true },
    });
    await createRolePermissions(tx, role.id, ROLE_DEFAULT_PERMISSIONS[entry.role] ?? []);
    ids[entry.key] = role.id;
  }

  for (const template of TENANT_ROLE_TEMPLATES) {
    const role = await tx.tenantRole.create({
      data: {
        tenant_id: tenantId,
        name: template.name,
        description: template.description,
        is_system: true,
        template_key: template.key,
      },
    });
    await createRolePermissions(tx, role.id, template.permissions);
    ids[template.key] = role.id;
  }

  return ids;
}

async function createRolePermissions(tx: any, tenantRoleId: string, permissions: StorePermission[]) {
  if (permissions.length === 0) return;
  await tx.tenantRolePermission.createMany({
    data: permissions.map((permission) => ({ tenant_role_id: tenantRoleId, permission })),
    skipDuplicates: true,
  });
}
