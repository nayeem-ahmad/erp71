import { ROLE_DEFAULT_PERMISSIONS, UserRole } from '@erp71/shared-types';

const SYSTEM_ROLES: { key: 'manager' | 'cashier' | 'accountant'; name: string; role: UserRole }[] = [
  { key: 'manager', name: 'Manager', role: UserRole.MANAGER },
  { key: 'cashier', name: 'Cashier', role: UserRole.CASHIER },
  { key: 'accountant', name: 'Accountant', role: UserRole.ACCOUNTANT },
];

export async function seedDefaultTenantRoles(tx: any, tenantId: string) {
  const ids: Record<string, string> = {};
  for (const entry of SYSTEM_ROLES) {
    const role = await tx.tenantRole.create({
      data: { tenant_id: tenantId, name: entry.name, is_system: true },
    });
    const perms = ROLE_DEFAULT_PERMISSIONS[entry.role] ?? [];
    if (perms.length > 0) {
      await tx.tenantRolePermission.createMany({
        data: perms.map((permission) => ({ tenant_role_id: role.id, permission })),
        skipDuplicates: true,
      });
    }
    ids[entry.key] = role.id;
  }
  return ids;
}