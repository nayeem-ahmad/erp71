import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
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
        };
    },
);
