import * as path from 'path';
import { scanRoutes } from './route-authorization.scan';
import { OPEN_ROUTES } from './route-authorization.baseline';

/**
 * Default-deny for tenant-scoped routes.
 *
 * A route behind `JwtAuthGuard` alone — or behind `StorePermissionGuard` /
 * `TenantRoleGuard` with no permission or role declared — is open to **every
 * member of the workspace**, including a Project User and a portal-only employee.
 * `StorePermissionGuard` lets a handler through when it names no permission, so a
 * guard on the controller looks like protection and is none.
 *
 * Every such route must therefore appear in `route-authorization.baseline.ts`
 * with the reason it is open. The list is a ratchet: a new route that is open
 * fails here, and a route that gets gated must be removed from the list, so it
 * can only shrink.
 */
describe('route authorization', () => {
    const routes = scanRoutes(path.join(__dirname, '..'));
    const open = routes.filter((route) => route.gate === 'open');

    it('finds the controllers, so an empty scan cannot pass for a clean one', () => {
        expect(routes.length).toBeGreaterThan(500);
        expect(routes.filter((route) => route.gate === 'permission').length).toBeGreaterThan(300);
    });

    it('has one key per route handler', () => {
        const keys = routes.map((route) => route.key);
        expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
    });

    it('lets no new route ship open to every workspace member', () => {
        const unlisted = open
            .filter((route) => !(route.key in OPEN_ROUTES))
            .map((route) => `${route.verb} ${route.route}  (${route.key}, ${route.file})`);

        expect(unlisted).toEqual([]);
        // If this fails: give the handler @RequireStorePermission(...) (or
        // @TenantRoles with TenantRoleGuard). Only if it is genuinely meant for every
        // member — a self-scoped read, say — add it to the baseline WITH the reason.
    });

    it('drops a route from the baseline once it is gated, so the list only shrinks', () => {
        const stillOpen = new Set(open.map((route) => route.key));
        const stale = Object.keys(OPEN_ROUTES).filter((key) => !stillOpen.has(key));

        expect(stale).toEqual([]);
    });

    it('gives every baseline entry a reason', () => {
        const blank = Object.entries(OPEN_ROUTES)
            .filter(([, reason]) => !reason || reason.trim().length < 8)
            .map(([key]) => key);

        expect(blank).toEqual([]);
    });
});
