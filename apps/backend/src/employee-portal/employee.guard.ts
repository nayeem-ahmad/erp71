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

        // Every portal-enabled card this login holds — one per workspace at
        // most, but a person can be staff in more than one workspace.
        const candidates = await this.db.employee.findMany({
            where: {
                user_id: userId,
                portal_access: true,
                status: 'ACTIVE',
                deleted_at: null,
            },
            orderBy: { created_at: 'asc' },
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

        const employee = pickEmployee(candidates, request.headers?.['x-tenant-id']);
        if (!employee) {
            throw new ForbiddenException(
                candidates.length > 1
                    ? 'Choose which workspace to open the employee portal in.'
                    : 'Employee portal access is required',
            );
        }

        request.employee = employee;
        // Portal endpoints scope by the employee's own tenant, resolved here
        // rather than from the `x-tenant-id` header a client could set.
        request.tenantId = employee.tenant_id;
        return true;
    }
}

/**
 * Which of a login's own portal cards this request is for.
 *
 * The workspace header only ever *chooses among the caller's own cards* — the
 * candidates are already narrowed to the token's user — so a forged header
 * can at worst pick another card that is theirs anyway. One card is used
 * whatever the header says, as it was before a login could hold several. More
 * than one with no header naming one of them is ambiguous, and refused rather
 * than guessed.
 */
export function pickEmployee<T extends { tenant_id: string }>(
    candidates: readonly T[],
    tenantHeader: unknown,
): T | null {
    if (candidates.length === 0) return null;
    if (typeof tenantHeader === 'string' && tenantHeader) {
        const named = candidates.find((candidate) => candidate.tenant_id === tenantHeader);
        if (named) return named;
    }
    return candidates.length === 1 ? candidates[0] : null;
}
