import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantRecordScope } from '@erp71/shared-types';
import { resolveZone } from '../common/tenant-time.util';

export interface TenantContext {
    tenantId: string;
    storeId?: string;
    userId: string;
    userRole?: string;
    /**
     * The workspace's IANA zone, resolved by `TenantInterceptor` from the
     * membership lookup it already performs. Every calendar-day filter and
     * "today" window is measured in it — see `common/tenant-time.util.ts`.
     * Falls back to the platform default when the interceptor did not run.
     */
    timezone: string;
    /**
     * How much of the data this member's permissions reach they may read: the
     * widest scope across the roles they hold, resolved by `TenantInterceptor`
     * from the same membership lookup. `ALL` unless every role they hold is
     * narrowed — see `TenantRecordScope`.
     *
     * The decorator always sets it, and defaults it to `ALL` when the
     * interceptor did not run — safe rather than permissive, since the decorator
     * already throws when `tenantId` is unset, so an authenticated request
     * cannot reach a handler without both being resolved.
     *
     * Optional on the type for the contexts nobody builds from a request — a
     * sweep, a scheduler, a spec. Those are the system rather than a person, and
     * absence reads as `ALL` everywhere it is consumed.
     */
    recordScope?: TenantRecordScope;
}

export const Tenant = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): TenantContext => {
        const request = ctx.switchToHttp().getRequest();
        if (request.user?.userId && !request.tenantId) {
            throw new BadRequestException('Tenant context is required for this request.');
        }

        return {
            tenantId: request.tenantId,
            storeId: request.storeId,
            userId: request.user?.userId,
            userRole: request.userRole,
            timezone: resolveZone(request.timezone),
            recordScope: request.recordScope ?? TenantRecordScope.ALL,
        };
    },
);
