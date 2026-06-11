import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Put,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TeamService } from './team.service';
import {
    GrantStoreAccessDto,
    InviteMemberDto,
    SetStorePermissionsDto,
    UpdateRoleDto,
} from './team.dto';

@Controller('team')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class TeamController {
    constructor(private readonly team: TeamService) {}

    @Get('members')
    listMembers(@Tenant() ctx: TenantContext) {
        return this.team.listMembers(ctx);
    }

    @Get('stores')
    listStores(@Tenant() ctx: TenantContext) {
        return this.team.listStores(ctx);
    }

    @Get('invitations')
    listInvitations(@Tenant() ctx: TenantContext) {
        return this.team.listInvitations(ctx);
    }

    @Post('invitations')
    invite(@Tenant() ctx: TenantContext, @Body() dto: InviteMemberDto) {
        return this.team.invite(ctx, dto.email, dto.role);
    }

    @Delete('invitations/:id')
    revokeInvitation(@Tenant() ctx: TenantContext, @Param('id') id: string) {
        return this.team.revokeInvitation(ctx, id);
    }

    @Get('members/:userId')
    getMember(@Tenant() ctx: TenantContext, @Param('userId') userId: string) {
        return this.team.getMember(ctx, userId);
    }

    @Patch('members/:userId/role')
    updateRole(@Tenant() ctx: TenantContext, @Param('userId') userId: string, @Body() dto: UpdateRoleDto) {
        return this.team.updateRole(ctx, userId, dto.role, dto.reseedPermissions ?? false);
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
