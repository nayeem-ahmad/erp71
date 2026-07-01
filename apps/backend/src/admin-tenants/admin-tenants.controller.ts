import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantsService } from './admin-tenants.service';
import {
    ListAdminTenantsQueryDto,
    UpdateAdminTenantSubscriptionDto,
    UpdateAdminTenantLocalizationDto,
    SuspendTenantDto,
    CreateAdminTenantDto,
} from './admin-tenants.dto';

@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminTenantsController {
    constructor(private readonly adminTenantsService: AdminTenantsService) {}

    @Get()
    listTenants(@Query() query: ListAdminTenantsQueryDto) {
        return this.adminTenantsService.listTenants(query);
    }

    @Post()
    createTenant(
        @Body() dto: CreateAdminTenantDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.createTenant(dto, req.user.userId);
    }

    @Get(':tenantId')
    getTenant(@Param('tenantId') tenantId: string) {
        return this.adminTenantsService.getTenant(tenantId);
    }

    @Patch(':tenantId/subscription')
    updateSubscription(
        @Param('tenantId') tenantId: string,
        @Body() dto: UpdateAdminTenantSubscriptionDto,
    ) {
        return this.adminTenantsService.updateSubscription(tenantId, dto);
    }

    @Patch(':tenantId/localization')
    updateLocalization(
        @Param('tenantId') tenantId: string,
        @Body() dto: UpdateAdminTenantLocalizationDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.updateLocalization(tenantId, dto, req.user.userId);
    }

    @Patch(':tenantId/suspend')
    suspendTenant(
        @Param('tenantId') tenantId: string,
        @Body() dto: SuspendTenantDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.suspendTenant(tenantId, dto, req.user.userId);
    }

    @Post(':tenantId/impersonate')
    impersonateTenant(
        @Param('tenantId') tenantId: string,
        @Request() req: any,
    ) {
        return this.adminTenantsService.impersonateTenant(tenantId, req.user.userId);
    }
}
