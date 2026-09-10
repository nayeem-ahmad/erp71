import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { resolveCoarseRolesForNames } from '@erp71/shared-types';
import { TENANT_ROLES_KEY } from './tenant-roles.decorator';

@Injectable()
export class TenantRoleGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly db: DatabaseService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(TENANT_ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const userId = request.user?.userId;
        const tenantIdHeader = request.headers['x-tenant-id'];
        const tenantId = Array.isArray(tenantIdHeader) ? tenantIdHeader[0] : tenantIdHeader;

        if (!userId || !tenantId) {
            throw new UnauthorizedException('Missing tenant context');
        }

        const membership = await this.db.tenantUser.findUnique({
            where: {
                tenant_id_user_id: {
                    tenant_id: tenantId,
                    user_id: userId,
                },
            },
            include: { roles: { select: { tenantRole: { select: { name: true } } } } },
        });

        if (!membership) {
            throw new UnauthorizedException('Invalid tenant context');
        }

        request.tenantRole = membership.role;

        if (requiredRoles.includes(membership.role)) {
            return true;
        }

        // `TenantUser.role` holds one value, but a member holds a set of roles and
        // their access is the union of it. Someone who is both a Tenant Admin and an
        // Accounting User would otherwise lose whichever gate the stored enum did not
        // win, so fall back to the gates every role they hold opens. OWNER is never
        // derived from a role name, so it stays unreachable this way.
        const heldNames = membership.roles.map((assignment) => assignment.tenantRole.name);
        if (resolveCoarseRolesForNames(heldNames).some((role) => requiredRoles.includes(role))) {
            return true;
        }

        throw new ForbiddenException('You do not have access to the accounting module');
    }
}