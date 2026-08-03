import {
    addNavNodesToLayout,
    getDefaultNavLayout,
    NavScope,
    validateNavLayout,
    type NavLayoutNode,
} from '@erp71/shared-types';

/**
 * `resolveTenantSidebarLayout` returns a saved layout verbatim — it does not
 * merge NAV_REGISTRY into it. So a nav entry added in code after an admin
 * customised the sidebar is invisible in production while looking correct in the
 * repo. This is the helper that closes that gap, and these are the properties it
 * has to hold for it to be safe to run against a live layout.
 */
describe('addNavNodesToLayout', () => {
    /** A customised layout: CRM keeps only overview/leads/customers. */
    const customised: NavLayoutNode[] = [
        { id: 'crm', parentId: null, sortOrder: 6, visible: true },
        { id: 'crm.overview', parentId: 'crm', sortOrder: 0, visible: true },
        { id: 'crm.leads', parentId: 'crm', sortOrder: 1, visible: true },
        { id: 'crm.customers', parentId: 'crm', sortOrder: 2, visible: true },
    ];

    it('adds a newly-registered node and leaves the result valid', () => {
        const { layout, added } = addNavNodesToLayout(customised, ['crm.setup']);

        expect(added).toEqual(['crm.setup']);
        expect(layout.find((n) => n.id === 'crm.setup')).toEqual(
            expect.objectContaining({ id: 'crm.setup', parentId: 'crm' }),
        );
        expect(validateNavLayout(layout)).toEqual({ valid: true });
    });

    it('appends after existing siblings instead of reusing the default order', () => {
        // The default puts lead-taxonomy at sortOrder 6, but this layout's CRM
        // children stop at 2 — reusing 6 could collide with a customised sibling.
        const { layout } = addNavNodesToLayout(customised, ['crm.setup']);
        const node = layout.find((n) => n.id === 'crm.setup');

        expect(node?.sortOrder).toBe(3);
    });

    it('does not disturb the nodes already in the layout', () => {
        const { layout } = addNavNodesToLayout(customised, ['crm.setup']);

        for (const original of customised) {
            expect(layout).toContainEqual(original);
        }
    });

    it('is idempotent', () => {
        const first = addNavNodesToLayout(customised, ['crm.setup']);
        const second = addNavNodesToLayout(first.layout, ['crm.setup']);

        expect(second.added).toEqual([]);
        expect(second.skipped).toEqual([{ id: 'crm.setup', reason: 'already present' }]);
        expect(second.layout).toEqual(first.layout);
    });

    it('skips a node whose parent module the admin removed, rather than orphaning it', () => {
        // An orphan child fails validateNavLayout, which would make the whole
        // saved layout unloadable — worse than the missing menu item.
        const withoutCrm: NavLayoutNode[] = [{ id: 'help', parentId: null, sortOrder: 1, visible: true }];
        const { layout, added, skipped } = addNavNodesToLayout(withoutCrm, ['crm.setup']);

        expect(added).toEqual([]);
        expect(skipped).toEqual([{ id: 'crm.setup', reason: 'parent "crm" is not in this layout' }]);
        expect(layout).toEqual(withoutCrm);
    });

    it('skips an unknown id instead of writing a node that fails validation', () => {
        const { added, skipped } = addNavNodesToLayout(customised, ['crm.not-a-real-node']);

        expect(added).toEqual([]);
        expect(skipped).toEqual([{ id: 'crm.not-a-real-node', reason: 'not in registry' }]);
    });

    it('leaves a full default layout untouched', () => {
        const defaults = getDefaultNavLayout(NavScope.TENANT);
        const { layout, added } = addNavNodesToLayout(defaults, ['crm.setup']);

        expect(added).toEqual([]);
        expect(layout).toEqual(defaults);
    });

    it('ships crm.setup in the default layout under the crm module', () => {
        const defaults = getDefaultNavLayout(NavScope.TENANT);
        const node = defaults.find((n) => n.id === 'crm.setup');

        expect(node).toEqual(expect.objectContaining({ parentId: 'crm' }));
        expect(validateNavLayout(defaults)).toEqual({ valid: true });
    });
});
