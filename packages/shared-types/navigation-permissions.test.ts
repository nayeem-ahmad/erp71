import {
    NAV_PERMISSIONS,
    NAV_REGISTRY,
    StorePermission,
    TENANT_ROLE_TEMPLATES,
} from './index';

const VALID_PERMISSIONS = new Set<string>(Object.values(StorePermission));

describe('NAV_PERMISSIONS', () => {
    it('only names nodes that exist in the registry', () => {
        const unknown = Object.keys(NAV_PERMISSIONS).filter((id) => !NAV_REGISTRY[id]);
        expect(unknown).toEqual([]);
    });

    it('only asks for permissions that exist, so a typo cannot hide a page from everyone', () => {
        const bad = Object.entries(NAV_PERMISSIONS).flatMap(([id, perms]) =>
            perms.filter((perm) => !VALID_PERMISSIONS.has(perm)).map((perm) => `${id}: ${perm}`),
        );
        expect(bad).toEqual([]);
    });

    it('never lists an empty set, which would hide the node from every non-owner', () => {
        const empty = Object.entries(NAV_PERMISSIONS).filter(([, perms]) => perms.length === 0);
        expect(empty).toEqual([]);
    });

    /**
     * The safety net. A wrong entry hides a page someone needs, so every built-in
     * role must still see the module it was written for. Modules not listed here
     * are gated by other rules (plan, platform switch) or carry no tag at all.
     */
    describe('the built-in role templates still see their own module', () => {
        const NAV_MODULE_FOR_TEMPLATE_MODULE: Record<string, string> = {
            Sales: 'sales',
            Purchase: 'purchase',
            Inventory: 'inventory',
            Catalog: 'inventory',
            CRM: 'crm',
            HR: 'hr',
            Imports: 'imports',
            Marketing: 'storefront',
        };

        for (const template of TENANT_ROLE_TEMPLATES) {
            const navModule = NAV_MODULE_FOR_TEMPLATE_MODULE[template.module];
            if (!navModule) continue;

            it(`${template.name} sees ${navModule}`, () => {
                const needed = NAV_PERMISSIONS[navModule];
                expect(needed).toBeDefined();
                expect(template.permissions.some((perm) => needed.includes(perm))).toBe(true);
            });
        }

        it('leaves Projects untagged, since a project role already gates it on VIEW_PROJECTS', () => {
            expect(NAV_PERMISSIONS.projects).toBeUndefined();
        });

        it('keeps the tenant configuration screens open to the administration roles', () => {
            const admin = TENANT_ROLE_TEMPLATES.find((tpl) => tpl.key === 'administration_manager');
            expect(admin).toBeDefined();
            for (const id of ['account-settings.branding', 'account-settings.counters']) {
                expect(admin!.permissions.some((perm) => NAV_PERMISSIONS[id].includes(perm))).toBe(true);
            }
        });
    });

    it('does not tag anything a Project User is meant to reach', () => {
        const projectUser = TENANT_ROLE_TEMPLATES.find((tpl) => tpl.key === 'project_user')!;
        const held = new Set<string>(projectUser.permissions);
        const projectNodes = Object.keys(NAV_REGISTRY).filter(
            (id) => id === 'projects' || id.startsWith('projects.'),
        );
        const hidden = projectNodes.filter(
            (id) => NAV_PERMISSIONS[id] && !NAV_PERMISSIONS[id].some((perm) => held.has(perm)),
        );
        // Setup is the one Projects screen that needs its own management key.
        expect(hidden).toEqual(['projects.setup']);
    });
});
