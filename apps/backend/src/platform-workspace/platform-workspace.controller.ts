import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { PlatformWorkspaceService } from './platform-workspace.service';

/**
 * Hands the admin console the tenant id its project pages run against.
 *
 * The client cannot derive it: the platform workspace is deliberately absent
 * from `/auth/me`'s tenant list, because it is not a shop the user can enter.
 * This is the one endpoint that names it, and asking for it is also what
 * provisions it — see `PlatformWorkspaceService`.
 */
@Controller('platform/workspace')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformWorkspaceController {
    constructor(private readonly workspace: PlatformWorkspaceService) {}

    @Get()
    resolve(@Request() req: { user: { userId: string } }) {
        return this.workspace.resolveForAdmin(req.user.userId);
    }
}
