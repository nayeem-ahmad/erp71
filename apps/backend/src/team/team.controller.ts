import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PaginationDto } from '../common/pagination.dto';
import { TeamService } from './team.service';
import { NoAudit } from '../audit/no-audit.decorator';
import {
    CreateTenantRoleDto,
    GrantStoreAccessDto,
    InviteMemberDto,
    SetStorePermissionsDto,
    UpdateRoleDto,
    UpdateTenantRoleDto,
} from './team.dto';

/**
 * Reads the role set out of a body that may carry either the plural
 * `tenantRoleIds` or the older singular `tenantRoleId`. Empty is left for the
 * service to reject, so the message is the same wherever the call came from.
 */
function roleIdsFrom(dto: { tenantRoleId?: string; tenantRoleIds?: string[] }): string[] {
    if (dto.tenantRoleIds?.length) return dto.tenantRoleIds;
    return dto.tenantRoleId ? [dto.tenantRoleId] : [];
}

@Controller('team')
// Every mutating handler here writes its own richer `team.*` audit row.
@NoAudit()
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class TeamController {
    constructor(private readonly team: TeamService) {}

    @Get('members')
    listMembers(@Tenant() ctx: TenantContext, @Query() query: PaginationDto) {
        return this.team.listMembers(ctx, query.page, query.limit);
    }

    @Get('stores')
    listStores(@Tenant() ctx: TenantContext) {
        return this.team.listStores(ctx);
    }

    @Get('roles')
    listRoles(@Tenant() ctx: TenantContext) {
        return this.team.listRoles(ctx);
    }

    @Post('roles')
    createRole(@Tenant() ctx: TenantContext, @Body() dto: CreateTenantRoleDto) {
        return this.team.createRole(ctx, dto);
    }

    @Patch('roles/:id')
    updateRoleTemplate(
        @Tenant() ctx: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateTenantRoleDto,
    ) {
        return this.team.updateRoleTemplate(ctx, id, dto);
    }

    @Delete('roles/:id')
    deleteRole(@Tenant() ctx: TenantContext, @Param('id') id: string) {
        return this.team.deleteRole(ctx, id);
    }

    @Get('invitations')
    listInvitations(@Tenant() ctx: TenantContext) {
        return this.team.listInvitations(ctx);
    }

    @Post('invitations')
    invite(@Tenant() ctx: TenantContext, @Body() dto: InviteMemberDto) {
        return this.team.invite(ctx, dto.email, roleIdsFrom(dto));
    }

    @Delete('invitations/:id')
    revokeInvitation(@Tenant() ctx: TenantContext, @Param('id') id: string) {
        return this.team.revokeInvitation(ctx, id);
    }

    @Get('members/:userId')
    getMember(@Tenant() ctx: TenantContext, @Param('userId') userId: string) {
        return this.team.getMember(ctx, userId);
    }

    /**
     * Accepts both shapes: `{ tenantRoleIds }` for a member holding several roles,
     * and the older `{ tenantRoleId }` for one. The route keeps its singular name
     * so existing clients keep working.
     */
    @Patch('members/:userId/role')
    updateRole(@Tenant() ctx: TenantContext, @Param('userId') userId: string, @Body() dto: UpdateRoleDto) {
        return this.team.updateRoles(ctx, userId, roleIdsFrom(dto));
    }

    @Patch('members/:userId/roles')
    updateRoles(@Tenant() ctx: TenantContext, @Param('userId') userId: string, @Body() dto: UpdateRoleDto) {
        return this.team.updateRoles(ctx, userId, roleIdsFrom(dto));
    }

    @Post('members/:userId/stores')
    grantStoreAccess(
        @Tenant() ctx: TenantContext,
        @Param('userId') userId: string,
        @Body() dto: GrantStoreAccessDto,
    ) {
        return this.team.grantStoreAccess(ctx, userId, dto.storeId, dto.accessLevel, dto.seedDefaults ?? true);
    }

    @Delete('members/:userId/stores/:storeId')
    revokeStoreAccess(
        @Tenant() ctx: TenantContext,
        @Param('userId') userId: string,
        @Param('storeId') storeId: string,
    ) {
        return this.team.revokeStoreAccess(ctx, userId, storeId);
    }

    @Put('members/:userId/stores/:storeId/permissions')
    setStorePermissions(
        @Tenant() ctx: TenantContext,
        @Param('userId') userId: string,
        @Param('storeId') storeId: string,
        @Body() dto: SetStorePermissionsDto,
    ) {
        return this.team.setStorePermissions(ctx, userId, storeId, dto.permissions);
    }

    @Delete('members/:userId')
    removeMember(@Tenant() ctx: TenantContext, @Param('userId') userId: string) {
        return this.team.removeMember(ctx, userId);
    }
}
