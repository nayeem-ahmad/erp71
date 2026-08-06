import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Resolves the `Employee` behind the current login and attaches it as
 * `request.employee`. Modelled on `RefereeGuard`.
 *
 * **How this differs from the referee and investor portals, and why it
 * matters.** A referee has no `TenantUser` row, so `TenantInterceptor` never
 * sets `request.tenantId` and a referee token is *structurally* incapable of
 * reaching a staff endpoint. An employee is not like that: they are a real
 * tenant member with a real membership row, so their token is an ordinary ERP
 * token and `active_context === 'employee'` is a UI affordance, not a security
 * boundary.
 *
 * What keeps an employee out of the staff screens is therefore **permissions
 * alone** — an employee-portal user is provisioned with no store permissions,
 * so `StorePermissionGuard` refuses every guarded controller. That is only a
 * real defence because Phase 0 put the HR endpoints behind that guard; before
 * it, this portal would have handed every employee the whole employee list.
 * `employee-portal.security.spec.ts` pins the invariant.
 *
 * The consequence for this guard: it must resolve the employee **from the
 * token**, never from a route or query parameter. Every endpoint behind it
 * reads `request.employee.id` and nothing else, so one employee cannot read
 * another by guessing an id.
 */
@Injectable()
export class EmployeeGuard implements CanActivate {
    constructor(private readonly db: DatabaseService) {}

    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.userId;

        if (!userId) {
            throw new UnauthorizedException('Authentication is required');
        }

        const employee = await this.db.employee.findFirst({
            where: {
                user_id: userId,
                portal_access: true,
                status: 'ACTIVE',
                deleted_at: null,
            },
            select: {
                id: true,
                tenant_id: true,
                employee_code: true,
                name: true,
                phone: true,
                email: true,
                date_of_joining: true,
                status: true,
                department: { select: { id: true, name: true } },
                designation: { select: { id: true, name: true } },
            },
        });

        if (!employee) {
            throw new ForbiddenException('Employee portal access is required');
        }

        request.employee = employee;
        // Portal endpoints scope by the employee's own tenant, resolved here
        // rather than from the `x-tenant-id` header a client could set.
        request.tenantId = employee.tenant_id;
        return true;
    }
}
