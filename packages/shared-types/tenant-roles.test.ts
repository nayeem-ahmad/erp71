import {
    ROLE_DEFAULT_PERMISSIONS,
    StorePermission,
    SYSTEM_TENANT_ROLE_TO_USER_ROLE,
    TENANT_ROLE_MODULES,
    TENANT_ROLE_TEMPLATES,
    TENANT_ROLE_TEMPLATE_BY_KEY,
    TenantRoleLevel,
    UserRole,
    resolveBaseUserRole,
    resolveCoarseRolesForNames,
    resolveStrongestBaseUserRole,
} from "./index";

const VALID_PERMISSIONS = new Set<string>(Object.values(StorePermission));

describe("TENANT_ROLE_TEMPLATES", () => {
    it("has a unique key and a unique name per template", () => {
        const keys = TENANT_ROLE_TEMPLATES.map((tpl) => tpl.key);
        const names = TENANT_ROLE_TEMPLATES.map((tpl) => tpl.name);
        expect(new Set(keys).size).toBe(keys.length);
        expect(new Set(names).size).toBe(names.length);
    });

    it("never reuses the three legacy system role names", () => {
        // `TenantRole` is unique on (tenant, name), so a clash would make the seed
        // throw for every new tenant.
        const legacy = Object.keys(SYSTEM_TENANT_ROLE_TO_USER_ROLE);
        for (const template of TENANT_ROLE_TEMPLATES) {
            expect(legacy).not.toContain(template.name);
        }
    });

    it("grants only real permissions, with no duplicates", () => {
        for (const template of TENANT_ROLE_TEMPLATES) {
            expect(template.permissions.length).toBeGreaterThan(0);
            expect(new Set(template.permissions).size).toBe(template.permissions.length);
            for (const permission of template.permissions) {
                expect(VALID_PERMISSIONS.has(permission)).toBe(true);
            }
        }
    });

    it("pairs a manager and a user role in every module outside Administration", () => {
        for (const module of TENANT_ROLE_MODULES) {
            if (module === "Administration") continue;
            const levels = TENANT_ROLE_TEMPLATES.filter((tpl) => tpl.module === module).map(
                (tpl) => tpl.level,
            );
            expect(levels).toContain(TenantRoleLevel.MANAGER);
            expect(levels).toContain(TenantRoleLevel.USER);
        }
    });

    it("gives the module's user role no more than its manager role", () => {
        for (const module of TENANT_ROLE_MODULES) {
            if (module === "Administration") continue;
            const manager = TENANT_ROLE_TEMPLATES.find(
                (tpl) => tpl.module === module && tpl.level === TenantRoleLevel.MANAGER,
            )!;
            const user = TENANT_ROLE_TEMPLATES.find(
                (tpl) => tpl.module === module && tpl.level === TenantRoleLevel.USER,
            )!;
            const held = new Set<string>(manager.permissions);
            for (const permission of user.permissions) {
                expect(held.has(permission)).toBe(true);
            }
        }
    });

    it("gives Tenant Admin every permission", () => {
        const admin = TENANT_ROLE_TEMPLATE_BY_KEY.tenant_admin;
        expect(admin.level).toBe(TenantRoleLevel.ADMIN);
        expect([...admin.permissions].sort()).toEqual([...Object.values(StorePermission)].sort());
    });

    it("keeps VIEW_ALL_PROJECTS out of every template", () => {
        // It overrides per-project privacy, so it stays a grant an owner makes on
        // purpose — the same stance `sync-role-permissions.ts` takes.
        for (const template of TENANT_ROLE_TEMPLATES) {
            if (template.key === "tenant_admin") continue;
            expect(template.permissions).not.toContain(StorePermission.VIEW_ALL_PROJECTS);
        }
    });

    it("reserves MANAGER for the administration roles and ACCOUNTANT for accounting", () => {
        // The coarse gates are workspace-wide: MANAGER lets someone add staff and
        // ACCOUNTANT opens the accounting module. A manager of one other module must
        // inherit neither just for being a manager.
        for (const template of TENANT_ROLE_TEMPLATES) {
            for (const coarse of template.coarseRoles) {
                if (coarse === UserRole.MANAGER) expect(template.module).toBe("Administration");
                if (coarse === UserRole.ACCOUNTANT) {
                    expect(["Accounting", "Administration"]).toContain(template.module);
                }
            }
        }
    });

    it("declares at least one coarse role per template", () => {
        for (const template of TENANT_ROLE_TEMPLATES) {
            expect(template.coarseRoles.length).toBeGreaterThan(0);
            expect(new Set(template.coarseRoles).size).toBe(template.coarseRoles.length);
        }
    });

    it("lets Tenant Admin through both the staffing and the accounting gate", () => {
        // One enum column cannot say "administrator AND accountant"; the guard reads
        // the union, so the template has to declare both.
        expect(resolveCoarseRolesForNames(["Tenant Admin"]).sort()).toEqual(
            [UserRole.ACCOUNTANT, UserRole.MANAGER].sort(),
        );
    });

    it("indexes every template by key", () => {
        expect(Object.keys(TENANT_ROLE_TEMPLATE_BY_KEY)).toHaveLength(TENANT_ROLE_TEMPLATES.length);
    });
});

describe("resolveBaseUserRole", () => {
    it("still maps the three legacy system roles", () => {
        expect(resolveBaseUserRole("Manager")).toBe(UserRole.MANAGER);
        expect(resolveBaseUserRole("Cashier")).toBe(UserRole.CASHIER);
        expect(resolveBaseUserRole("Accountant")).toBe(UserRole.ACCOUNTANT);
    });

    it("maps a seeded template by the name it is created with", () => {
        expect(resolveBaseUserRole("Tenant Admin")).toBe(UserRole.MANAGER);
        expect(resolveBaseUserRole("Accounting User")).toBe(UserRole.ACCOUNTANT);
        expect(resolveBaseUserRole("Accounting Manager")).toBe(UserRole.ACCOUNTANT);
    });

    it("falls back to CASHIER for a renamed or owner-authored role", () => {
        expect(resolveBaseUserRole("Shop Floor Lead")).toBe(UserRole.CASHIER);
        expect(resolveBaseUserRole(null)).toBe(UserRole.CASHIER);
        expect(resolveBaseUserRole(undefined)).toBe(UserRole.CASHIER);
    });

    it("keeps a module manager at CASHIER so it inherits no workspace-wide gate", () => {
        expect(resolveBaseUserRole("Sales Manager")).toBe(UserRole.CASHIER);
        expect(resolveBaseUserRole("CRM Manager")).toBe(UserRole.CASHIER);
    });
});

describe("resolveStrongestBaseUserRole", () => {
    it("takes the strongest of the set", () => {
        expect(resolveStrongestBaseUserRole(["Sales User", "Tenant Admin"])).toBe(UserRole.MANAGER);
        expect(resolveStrongestBaseUserRole(["Sales User", "Accounting User"])).toBe(UserRole.ACCOUNTANT);
        expect(resolveStrongestBaseUserRole(["Sales User", "CRM User"])).toBe(UserRole.CASHIER);
    });

    it("is CASHIER for an empty set", () => {
        expect(resolveStrongestBaseUserRole([])).toBe(UserRole.CASHIER);
    });

    it("ignores order", () => {
        expect(resolveStrongestBaseUserRole(["Tenant Admin", "Sales User"])).toBe(
            resolveStrongestBaseUserRole(["Sales User", "Tenant Admin"]),
        );
    });
});

describe("ROLE_DEFAULT_PERMISSIONS", () => {
    it("is untouched by the templates — the legacy roles still seed from it", () => {
        expect(ROLE_DEFAULT_PERMISSIONS[UserRole.OWNER]).toEqual(Object.values(StorePermission));
    });
});

describe("resolveCoarseRolesForNames", () => {
    it("unions the gates of every role held", () => {
        expect(resolveCoarseRolesForNames(["Sales Manager", "Accounting User"]).sort()).toEqual(
            [UserRole.ACCOUNTANT, UserRole.CASHIER].sort(),
        );
    });

    it("treats a renamed or owner-authored role as CASHIER", () => {
        expect(resolveCoarseRolesForNames(["Shop Floor Lead"])).toEqual([UserRole.CASHIER]);
    });

    it("still maps the three legacy system roles", () => {
        expect(resolveCoarseRolesForNames(["Manager", "Accountant"]).sort()).toEqual(
            [UserRole.ACCOUNTANT, UserRole.MANAGER].sort(),
        );
    });

    it("is empty for no roles at all", () => {
        expect(resolveCoarseRolesForNames([])).toEqual([]);
    });
});
