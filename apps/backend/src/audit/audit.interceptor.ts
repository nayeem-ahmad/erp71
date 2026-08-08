import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { NO_AUDIT_KEY } from './no-audit.decorator';
import {
    AUDITED_METHODS,
    buildAuditPayload,
    extractRequestMeta,
    extractResultId,
    resolveAuditTarget,
} from './audit-route.util';

/**
 * Records every successful mutation as an audit row — tenant-scoped ones with
 * their tenant, platform-admin ones with a null tenant.
 *
 * Registered globally, which makes coverage the default: a new business module
 * is audited the moment its routes exist, with no per-service wiring. Modules
 * that write their own richer rows opt out with `@NoAudit()`.
 *
 * Three ordering facts this relies on:
 *  - It is registered *after* `TransformInterceptor`, so it sits inside the
 *    envelope and `tap` sees the raw controller return value.
 *  - `TenantInterceptor` is controller-scoped and therefore runs inside this
 *    one, so `request.tenantId` is only populated by the time `tap` fires.
 *    Every field is read there, never before `next.handle()`.
 *  - Guards run before any interceptor, so `request.isPlatformAdmin` — set by
 *    `PlatformAdminGuard` — is already there when `tap` fires.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
    constructor(
        private readonly audit: AuditService,
        private readonly reflector: Reflector,
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() !== 'http') return next.handle();

        const request = context.switchToHttp().getRequest();
        if (!AUDITED_METHODS.has(String(request?.method).toUpperCase())) {
            return next.handle();
        }

        const optedOut = this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (optedOut) return next.handle();

        return next.handle().pipe(tap((result) => this.record(request, result)));
    }

    /**
     * Never throws and never rejects: an audit failure must not turn a
     * successful business write into a 500 for the user.
     */
    private record(request: any, result: unknown): void {
        try {
            const tenantId = request?.tenantId;
            const userId = request?.user?.userId;
            if (!userId) return;

            // A platform admin acts outside every tenant, so there is no
            // `tenantId` to scope the row to — and for a long time that meant
            // the widest-reaching actions on the platform (revoking a link,
            // suspending a tenant, rewriting platform settings) were the only
            // ones with no trail at all. Those rows are written with a null
            // tenant and read back through `GET /admin/audit-logs`.
            //
            // The flag, not the mere absence of a tenant, is what admits them:
            // storefront customers and portal users are authenticated and
            // tenant-less too, and their order placements are not platform
            // administration.
            const isPlatformAction = request?.isPlatformAdmin === true;
            if (!tenantId && !isPlatformAction) return;

            const target = resolveAuditTarget({
                method: request.method,
                path: request.route?.path ?? request.originalUrl ?? request.url ?? '',
                params: request.params,
            });
            if (!target) return;

            const extra: Record<string, unknown> = {};
            if (request.storeId) extra.store_id = request.storeId;
            // Without this a platform row is only distinguishable by a null
            // tenant, which is also what an unscoped legacy row looks like.
            if (isPlatformAction) extra._scope = 'platform';

            const payload = buildAuditPayload(
                request.body,
                Object.keys(extra).length ? extra : undefined,
            );

            void this.audit
                .log(
                    target.action,
                    target.entity,
                    { userId, tenantId: tenantId ?? undefined, ...extractRequestMeta(request) },
                    target.entityId ?? extractResultId(result),
                    payload,
                )
                .catch(() => {});
        } catch {
            // Deliberately swallowed — see the doc comment above.
        }
    }
}
