import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole, resolvePlatformRole } from '@erp71/shared-types';
import { isPlatformAdminEmail } from './platform-admin.util';
import { PLATFORM_ROLES_KEY } from './platform-roles.decorator';

/**
 * The admin console's gate. Full platform admins pass everywhere; a narrower
 * platform role (support engineer) passes only where the route or its
 * controller names it with `@AllowPlatformRoles`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user?.email) {
            throw new UnauthorizedException('Authentication is required');
        }

        // DB flag takes priority; email whitelist is a fallback for bootstrapping
        const role = resolvePlatformRole({
            isPlatformAdmin: user.isPlatformAdmin === true || isPlatformAdminEmail(user.email),
            platformRole: user.platformRole,
        });

        if (role === PlatformRole.ADMIN) {
            request.isPlatformAdmin = true;
            request.platformRole = role;
            return true;
        }

        const allowed = this.reflector.getAllAndOverride<string[] | undefined>(PLATFORM_ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!role || !allowed?.includes(role)) {
            throw new ForbiddenException('Platform admin access is required');
        }

        // Not `isPlatformAdmin`: other code reads that as "may do anything".
        // The audit trail still files the action as platform-scoped off this.
        request.platformRole = role;
        return true;
    }
}
