import * as fs from 'fs';
import * as path from 'path';
import { STORE_PERMISSIONS_KEY } from './store-permission.decorator';
import { TENANT_ROLES_KEY } from './tenant-roles.decorator';

/**
 * Reads how every controller route is protected, straight from the metadata Nest
 * itself uses, so what this reports is what the running app enforces.
 *
 * Exists because `StorePermissionGuard` lets a handler through when it declares
 * no permission — silently. A guard listed on a controller looks like protection
 * and is none until each handler names a permission, which is how about 350
 * routes came to be open to any member of a workspace.
 */

export type RouteGate =
    /** JwtAuthGuard + StorePermissionGuard, with a permission declared. */
    | 'permission'
    /** JwtAuthGuard + TenantRoleGuard, with roles declared. */
    | 'role'
    /** A guard that restricts *who* (platform admin, referee, employee, applicant…). */
    | 'purpose-guard'
    /** No authentication guard at all — public by design, not tenant-scoped. */
    | 'public'
    /** Authenticated as a tenant member, with nothing further required. */
    | 'open';

export interface RouteInfo {
    /** `ControllerClass.handler` — the key the baseline uses. */
    key: string;
    verb: string;
    route: string;
    file: string;
    gate: RouteGate;
}

const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];

/** Guards that identify a tenant member and nothing more. */
const IDENTITY_GUARDS = new Set(['JwtAuthGuard', 'CombinedAuthGuard']);
/** Guards that only let a specific kind of caller in. */
const PURPOSE_GUARDS = new Set([
    'PlatformAdminGuard',
    'RefereeGuard',
    'EmployeeGuard',
    'StorefrontCustomerGuard',
    'CareersJwtGuard',
    'JobSeekerGuard',
    'MetricsTokenGuard',
    'ApiKeyGuard',
]);

function guardNames(target: object | undefined): string[] {
    if (!target) return [];
    const guards = (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as { name: string }[];
    return guards.map((guard) => guard.name);
}

function joinRoute(prefix: unknown, sub: unknown): string {
    const parts = [prefix, sub].map((part) => String(Array.isArray(part) ? part[0] : (part ?? '')));
    return `/${parts.join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function controllerFiles(root: string): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.controller\.ts$/.test(entry.name)) found.push(full);
        }
    };
    walk(root);
    return found.sort();
}

export function scanRoutes(srcRoot: string): RouteInfo[] {
    const routes: RouteInfo[] = [];

    for (const file of controllerFiles(srcRoot)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(file) as Record<string, unknown>;

        for (const exported of Object.values(mod)) {
            if (typeof exported !== 'function' || !Reflect.hasMetadata(PATH_METADATA, exported)) continue;
            const controller = exported as { name: string; prototype: Record<string, unknown> };
            const classGuards = guardNames(controller);
            const classPermission = Reflect.getMetadata(STORE_PERMISSIONS_KEY, controller) as unknown[] | undefined;
            const classRoles = Reflect.getMetadata(TENANT_ROLES_KEY, controller) as unknown[] | undefined;
            const prefix = Reflect.getMetadata(PATH_METADATA, controller);

            for (const name of Object.getOwnPropertyNames(controller.prototype)) {
                const handler = controller.prototype[name];
                if (name === 'constructor' || typeof handler !== 'function') continue;
                const methodId = Reflect.getMetadata(METHOD_METADATA, handler);
                if (methodId === undefined) continue;

                const guards = new Set([...classGuards, ...guardNames(handler)]);
                const permissions = (Reflect.getMetadata(STORE_PERMISSIONS_KEY, handler) ?? classPermission) as
                    | unknown[]
                    | undefined;
                const roles = (Reflect.getMetadata(TENANT_ROLES_KEY, handler) ?? classRoles) as unknown[] | undefined;

                let gate: RouteGate;
                if ([...guards].some((guard) => PURPOSE_GUARDS.has(guard))) gate = 'purpose-guard';
                else if (![...guards].some((guard) => IDENTITY_GUARDS.has(guard))) gate = 'public';
                // A permission or role is only enforced when its guard is actually
                // listed: a decorator with no guard beside it does nothing.
                else if (guards.has('StorePermissionGuard') && permissions && permissions.length > 0) gate = 'permission';
                else if (guards.has('TenantRoleGuard') && roles && roles.length > 0) gate = 'role';
                else gate = 'open';

                routes.push({
                    key: `${controller.name}.${name}`,
                    verb: VERBS[methodId] ?? String(methodId),
                    route: joinRoute(prefix, Reflect.getMetadata(PATH_METADATA, handler)),
                    file: path.relative(srcRoot, file),
                    gate,
                });
            }
        }
    }
    return routes;
}
