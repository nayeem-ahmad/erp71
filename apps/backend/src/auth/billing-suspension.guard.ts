import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { ALLOW_WHEN_SUSPENDED_KEY } from './billing-suspension.decorator';

/** The methods that change state. A suspended workspace is read-only, so these stop. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Path prefixes that stay open while a workspace is suspended, because they are
 * how the suspension gets lifted or how someone gets out of it.
 *
 * Matched against the request path with the global `/api/v1` prefix already
 * stripped. Kept as a list rather than decorators on each route because several
 * live in modules a tenant-billing concern should not have to reach into.
 */
const ALWAYS_ALLOWED_PREFIXES = [
    'auth',       // sign in/out, refresh — locking these out would strand the owner
    'billing',    // checkout, confirm, webhooks: the way out of suspension
    'admin',      // platform staff acting on the tenant, incl. recording payment
    'support',    // asking for help about the suspension
    'contact',
    'feedback',
    'health',
];

/**
 * Blocks every write in a workspace frozen for non-payment.
 *
 * Registered globally so coverage is the default: a module added later is
 * covered the moment its routes exist, with no per-controller wiring. That
 * matters here — the point is that *nothing* can be entered, and a per-module
 * opt-in would silently miss whichever module someone forgets.
 *
 * Reads stay open on purpose. The tenant's data is theirs; suspension is a
 * commercial lever, not a hostage-taking, and an owner who cannot see their own
 * numbers also cannot work out what they owe or export before deciding to leave.
 *
 * This resolves the tenant itself rather than reading `request.tenantId`:
 * `TenantInterceptor` is controller-scoped, so it runs *after* every global
 * guard and that field is not yet populated here.
 */
@Injectable()
export class BillingSuspensionGuard implements CanActivate {
    constructor(
        private readonly db: DatabaseService,
        private readonly reflector: Reflector,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (context.getType() !== 'http') return true;

        const request = context.switchToHttp().getRequest();
        const method = String(request?.method ?? '').toUpperCase();
        if (!MUTATING_METHODS.has(method)) return true;

        // Unauthenticated requests have no workspace to be suspended; the auth
        // guards decide those on their own terms.
        const userId = request?.user?.userId;
        if (!userId) return true;

        // Platform staff must keep working on a suspended tenant — recording the
        // very payment that lifts it, for one.
        if (request?.user?.isPlatformAdmin) return true;

        if (this.isAlwaysAllowedPath(request)) return true;

        const optedOut = this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_SUSPENDED_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (optedOut) return true;

        const tenantId = await this.resolveTenantId(request, userId);
        if (!tenantId) return true;

        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { billing_suspended_at: true, billing_suspension_reason: true },
        });

        if (!tenant?.billing_suspended_at) return true;

        throw new ForbiddenException({
            message:
                tenant.billing_suspension_reason ??
                'This workspace is suspended for non-payment.',
            // A distinct code so the frontend can show the settle-up screen rather
            // than a generic permission error.
            code: 'WORKSPACE_SUSPENDED',
            suspendedAt: tenant.billing_suspended_at.toISOString(),
        });
    }

    private isAlwaysAllowedPath(request: { path?: string; url?: string }): boolean {
        const raw = String(request?.path ?? request?.url ?? '');
        // Strip query string, the global `/api/v1` prefix and any leading slash,
        // so the prefixes above read as plain module names.
        const path = raw
            .split('?')[0]
            .replace(/^\/+/, '')
            .replace(/^api\/v\d+\/?/, '');

        return ALWAYS_ALLOWED_PREFIXES.some(
            (prefix) => path === prefix || path.startsWith(`${prefix}/`),
        );
    }

    /**
     * The same resolution `TenantInterceptor` performs: an explicit header when
     * present, otherwise the user's sole membership. Deliberately does not
     * validate membership — that is the interceptor's job, and this guard only
     * needs to know which workspace's suspension state to read.
     */
    private async resolveTenantId(
        request: { headers?: Record<string, unknown> },
        userId: string,
    ): Promise<string | null> {
        const header = request?.headers?.['x-tenant-id'];
        if (typeof header === 'string' && header) return header;

        const memberships = await this.db.tenantUser.findMany({
            where: { user_id: userId, tenant: { deleted_at: null } },
            select: { tenant_id: true },
            take: 2,
        });

        return memberships.length === 1 ? memberships[0].tenant_id : null;
    }
}
