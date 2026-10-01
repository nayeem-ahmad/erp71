import * as path from 'path';
import {
    ROLE_DEFAULT_PERMISSIONS,
    StorePermission,
    TENANT_ROLE_TEMPLATES,
    TENANT_ROLE_TEMPLATE_BY_KEY,
    UserRole,
} from '@erp71/shared-types';
import { RouteInfo, scanRoutes } from './route-authorization.scan';

/**
 * The regression net for gating routes: real roles against real routes.
 *
 * Putting a permission on a route that had none can lock out the people who used
 * it. So each built-in role — the three legacy ones every existing workspace
 * still has, and the seeded templates — is pinned to the journeys it exists for,
 * and pinned *out* of the ones it must not reach.
 */
describe('route authorization by role', () => {
    const routes = scanRoutes(path.join(__dirname, '..'));
    const byAddress = new Map<string, RouteInfo>(routes.map((route) => [`${route.verb} ${route.route}`, route]));

    const passes = (held: readonly string[], route: RouteInfo) => {
        const have = new Set(held);
        const { all, any } = route.requires;
        return all.every((perm) => have.has(perm)) && (any.length === 0 || any.some((perm) => have.has(perm)));
    };
    /** Routes are addressed as `VERB /path` — what the frontend calls — not by handler name. */
    const route = (address: string) => {
        const found = byAddress.get(address);
        if (!found) throw new Error(`no such route: ${address}`);
        return found;
    };
    const template = (key: string) => TENANT_ROLE_TEMPLATE_BY_KEY[key].permissions as string[];
    const legacy = (role: UserRole) => ROLE_DEFAULT_PERMISSIONS[role] as string[];

    const canReach = (label: string, held: string[], keys: string[]) =>
        it(`${label} reaches ${keys.length} routes`, () => {
            const refused = keys.filter((key) => !passes(held, route(key)));
            expect(refused).toEqual([]);
        });
    const cannotReach = (label: string, held: string[], keys: string[]) =>
        it(`${label} is kept out of ${keys.length} routes`, () => {
            const allowed = keys.filter((key) => passes(held, route(key)));
            expect(allowed).toEqual([]);
        });

    // The hard-to-see failure: a route gated behind something nobody holds.
    it('leaves no gated route that only OWNER could ever reach', () => {
        const everything = Object.values(StorePermission) as string[];
        const templatePerms = new Set(TENANT_ROLE_TEMPLATES.flatMap((tpl) => tpl.permissions as string[]));
        const legacyPerms = new Set(Object.values(UserRole).flatMap((role) => legacy(role)));
        const unreachable = routes
            .filter((r) => r.gate === 'permission')
            .filter((r) => {
                const reachable = [...templatePerms, ...legacyPerms];
                return !passes(reachable, r);
            })
            .map((r) => `${r.verb} ${r.route}`);

        expect(unreachable).toEqual([]);
        expect(routes.filter((r) => r.gate === 'permission').every((r) => passes(everything, r))).toBe(true);
    });

    describe('the legacy Cashier — what every existing workspace’s till staff hold', () => {
        const cashier = legacy(UserRole.CASHIER);

        canReach('at the till, the Cashier', cashier, [
            'POST /sales',
            'GET /sales',
            'GET /sales/:id',
            'GET /sales/:id/invoice',
            'GET /customers',
            'POST /customers',
            'GET /customers/:id',
            'POST /cashier-sessions/open',
            'POST /cashier-sessions/:sessionId/close',
            'GET /cashier-sessions/:sessionId/summary',
            'GET /counters/active',
            'GET /payment-methods',
            'GET /payment-methods/default/:type',
            'GET /price-lists',
            'GET /products',
            'POST /loyalty/customers/:customerId/earn',
            'POST /loyalty/customers/:customerId/redeem',
            'POST /discount-codes/validate',
            'POST /sales-returns',
            'GET /print-templates/resolve',
        ]);

        cannotReach('the Cashier', cashier, [
            'GET /salary-payments',
            'POST /salary-payments',
            'POST /attendance/month-snapshot/freeze',
            'GET /loans',
            'POST /fund-transfers',
            'GET /suppliers/:id/credit',
            'GET /purchases',
            'POST /purchases',
            'POST /expenses/entries',
            'POST /api-keys',
            'DELETE /sales/:id',
            'POST /products',
            'POST /price-lists',
            'GET /manufacturing/jobs',
            'POST /crm/campaigns/:id/send',
            'GET /products/:sourceId/merge-preview',
            'POST /products/:sourceId/merge',
        ]);
    });

    describe('the legacy Manager', () => {
        canReach('the Manager', legacy(UserRole.MANAGER), [
            'POST /sales',
            'POST /purchases',
            'GET /suppliers/:id/credit',
            'POST /expenses/entries',
            'POST /fund-transfers',
            'POST /fund-transfers/:id/receive',
            'POST /loans',
            'GET /attendance',
            'POST /products',
            'POST /price-lists',
            'POST /counters',
            'POST /stock-takes',
            'POST /crm/campaigns/:id/send',
        ]);
    });

    // Deleting a posted sale reverses stock, ledger and credit, so it takes the
    // permission cancelling one does. No built-in role holds CANCEL_ENTRY: it is the
    // owner's (and a Tenant Admin's) unless a workspace grants it to a custom role.
    describe('deleting a posted sale', () => {
        cannotReach('the legacy Manager', legacy(UserRole.MANAGER), ['DELETE /sales/:id']);
        cannotReach('a Sales Manager', template('sales_manager'), ['DELETE /sales/:id']);
        canReach('a role granted CANCEL_ENTRY', [StorePermission.CANCEL_ENTRY], ['DELETE /sales/:id']);
    });

    describe('the seeded role templates keep the module they exist for', () => {
        canReach('a Sales User', template('sales_user'), [
            'POST /sales',
            'GET /sales',
            'POST /sales-orders',
            'POST /sales-quotations',
            'POST /sales-returns',
            'GET /customers',
            'POST /customers',
            'GET /customers/:id/credit',
            'GET /delivery',
            'GET /sales-reports/summary',
        ]);
        cannotReach('a Sales User', template('sales_user'), [
            'DELETE /sales/:id',
            'POST /purchases',
            'GET /salary-payments',
            'POST /products',
        ]);

        canReach('a Purchase User', template('purchase_user'), [
            'POST /purchases',
            'GET /purchases',
            'POST /purchase-orders',
            'GET /suppliers',
            'POST /suppliers',
            'GET /suppliers/:id/credit',
            'GET /payment-methods',
        ]);
        cannotReach('a Purchase User', template('purchase_user'), ['POST /sales', 'GET /loans']);

        canReach('an Inventory User', template('inventory_user'), [
            'POST /stock-takes',
            'POST /inventory-shrinkage',
            'GET /inventory/warehouses',
            'GET /inventory-reports/stock-on-hand',
        ]);
        canReach('a Catalog User', template('catalog_user'), [
            'POST /products',
            'GET /products',
            'POST /brands',
        ]);
        canReach('an Accounting User', template('accounting_user'), [
            'POST /expenses/entries',
            'GET /expenses/entries',
            'GET /customers/:id/credit',
            'GET /suppliers/:id/credit',
            'GET /sales-reports/summary',
            'GET /purchases',
            'POST /fund-transfers',
        ]);
        canReach('an HR Manager', template('hr_manager'), [
            'GET /attendance',
            'POST /attendance/month-snapshot/freeze',
            'POST /salary-payments',
        ]);
        canReach('an HR User', template('hr_user'), ['GET /attendance']);
        cannotReach('an HR User', template('hr_user'), [
            'POST /attendance/month-snapshot/freeze',
            'GET /salary-payments',
        ]);
        canReach('a CRM User', template('crm_user'), [
            'GET /crm/leads',
            'POST /crm/contacts',
            'POST /crm/interactions',
            'GET /customers',
        ]);
        cannotReach('a CRM User', template('crm_user'), ['POST /crm/campaigns/:id/send']);
        canReach('a CRM Manager', template('crm_manager'), ['POST /crm/campaigns/:id/send']);
        canReach('a Loans Manager', template('loans_manager'), ['GET /loans', 'POST /loans']);
        canReach('a Marketing Manager', template('marketing_manager'), [
            'GET /storefront/orders',
        ]);
        canReach('an Administration Manager', template('administration_manager'), [
            'POST /counters',
            'PATCH /tenants/branding',
            'POST /payment-methods',
        ]);
    });

    describe('product merge', () => {
        const mergeRoutes = ['GET /products/:sourceId/merge-preview', 'POST /products/:sourceId/merge'];
        cannotReach('the legacy Cashier', legacy(UserRole.CASHIER), mergeRoutes);
        cannotReach('the legacy Manager', legacy(UserRole.MANAGER), mergeRoutes);
        cannotReach('a Sales User', template('sales_user'), mergeRoutes);
        canReach('a Tenant Admin', template('tenant_admin'), mergeRoutes);
        canReach('a User Manager', template('administration_manager'), mergeRoutes);
        canReach('a role granted only MANAGE_USERS', [StorePermission.MANAGE_USERS], mergeRoutes);
    });

    describe('a Project User', () => {
        const projectUser = template('project_user');
        it('holds nothing that opens the retail, money or people routes', () => {
            const reachable = routes
                .filter((r) => r.gate === 'permission')
                .filter((r) => !r.file.startsWith('projects/') && !r.file.startsWith('chat/'))
                .filter((r) => passes(projectUser, r))
                .map((r) => `${r.verb} ${r.route}  (${r.key})`);

            expect(reachable).toEqual([]);
        });
    });
});
