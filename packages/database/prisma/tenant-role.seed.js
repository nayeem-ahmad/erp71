const { ROLE_DEFAULT_PERMISSIONS, TENANT_ROLE_TEMPLATES, UserRole } = require('@erp71/shared-types');

// Hand-maintained CommonJS companion of tenant-role.seed.ts — this is the file
// `packages/database/index.ts` actually resolves. Keep the two in step.

const LEGACY_SYSTEM_ROLES = [
    { key: 'manager', name: 'Manager', role: UserRole.MANAGER },
    { key: 'cashier', name: 'Cashier', role: UserRole.CASHIER },
    { key: 'accountant', name: 'Accountant', role: UserRole.ACCOUNTANT },
];

async function seedDefaultTenantRoles(tx, tenantId) {
    const ids = {};

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

async function createRolePermissions(tx, tenantRoleId, permissions) {
    if (permissions.length === 0) return;
    await tx.tenantRolePermission.createMany({
        data: permissions.map((permission) => ({ tenant_role_id: tenantRoleId, permission })),
        skipDuplicates: true,
    });
}

module.exports = { seedDefaultTenantRoles };
