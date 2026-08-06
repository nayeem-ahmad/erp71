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
 * Records every successful tenant-scoped mutation as an audit row.
 *
 * Registered globally, which makes coverage the default: a new business module
 * is audited the moment its routes exist, with no per-service wiring. Modules
 * that write their own richer rows opt out with `@NoAudit()`.
 *
 * Two ordering facts this relies on:
 *  - It is registered *after* `TransformInterceptor`, so it sits inside the
 *    envelope and `tap` sees the raw controller return value.
 *  - `TenantInterceptor` is controller-scoped and therefore runs inside this
 *    one, so `request.tenantId` is only populated by the time `tap` fires.
 *    Every field is read there, never before `next.handle()`.
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
            // Unauthenticated or non-tenant routes (storefront, platform admin,
            // webhooks) have nothing a tenant admin could act on.
            if (!tenantId || !userId) return;

            const target = resolveAuditTarget({
                method: request.method,
                path: request.route?.path ?? request.originalUrl ?? request.url ?? '',
                params: request.params,
            });
            if (!target) return;

            const payload = buildAuditPayload(
                request.body,
                request.storeId ? { store_id: request.storeId } : undefined,
            );

            void this.audit
                .log(
                    target.action,
                    target.entity,
                    { userId, tenantId, ...extractRequestMeta(request) },
                    target.entityId ?? extractResultId(result),
                    payload,
                )
                .catch(() => {});
        } catch {
            // Deliberately swallowed — see the doc comment above.
        }
    }
}
