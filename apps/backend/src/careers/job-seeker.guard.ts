import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DatabaseService } from '../database/database.service';
import { isApplicantScope } from '../auth/token-scope';

/**
 * Bearer auth for the careers portal.
 *
 * The mirror of `JwtAuthGuard`, which refuses applicant tokens: only tokens
 * minted by `POST /careers/auth/login` pass here, so a workspace owner's app
 * session cannot be pointed at the portal and silently act as whatever
 * job-seeker profile the same `User` happens to own. Both directions are
 * closed, which is what makes the careers login a genuinely separate surface
 * rather than a second door onto the same session.
 */
@Injectable()
export class CareersJwtGuard extends AuthGuard('jwt') {
    handleRequest<TUser = any>(err: any, user: any, info: any, context: any, status?: any): TUser {
        const resolved = super.handleRequest<TUser>(err, user, info, context, status);

        if (!isApplicantScope((resolved as any)?.scope)) {
            throw new UnauthorizedException('Sign in to the careers portal to continue');
        }

        return resolved;
    }
}

/**
 * Resolves the `JobSeeker` behind the current careers login and attaches it as
 * `request.jobSeeker`. Runs after `CareersJwtGuard`.
 *
 * **Why the scope check matters more here than in the other portals.** An
 * employee or a referee is a real member of a workspace, so their token is an
 * ordinary ERP token and what keeps them off staff screens is holding no store
 * permissions. A job seeker is weaker still: a `User` with no `TenantUser` row
 * anywhere, so `TenantInterceptor` can never resolve a tenant for them and no
 * guarded controller would admit them regardless. The scope is what closes the
 * other direction.
 *
 * **The invariant every handler behind this guard depends on:** the job seeker
 * is resolved from the token, never from a route or query parameter. Handlers
 * read `request.jobSeeker.id` and scope every query by it — including the walk
 * through `Applicant.user_id` that finds their applications — so one candidate
 * cannot read another's by guessing an id.
 *
 * There is deliberately no `request.tenantId`. This portal reads across
 * workspaces on purpose, so each handler names the scoping it needs rather than
 * inheriting a tenant a client could set with a header.
 */
@Injectable()
export class JobSeekerGuard implements CanActivate {
    constructor(private readonly db: DatabaseService) {}

    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.userId;

        if (!userId) {
            throw new UnauthorizedException('Authentication is required');
        }

        // Defence in depth: `CareersJwtGuard` already rejected non-applicant
        // scopes, but this guard is what handlers actually trust, so it does not
        // assume the guard before it ran.
        if (!isApplicantScope(request.user?.scope)) {
            throw new UnauthorizedException('Sign in to the careers portal to continue');
        }

        const jobSeeker = await this.db.jobSeeker.findFirst({
            where: { user_id: userId, deleted_at: null },
            select: { id: true, user_id: true, full_name: true, phone: true },
        });

        if (!jobSeeker) {
            throw new ForbiddenException('No careers profile found for this account');
        }

        request.jobSeeker = jobSeeker;
        return true;
    }
}
