import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { extractRequestMeta } from '../audit/audit-route.util';
import { ProjectCostingService } from './project-costing.service';
import { CostingSettingsDto } from './project.dto';

/**
 * Project costing, Phase A. Its own prefix rather than routes under
 * `projects/:id`, so nothing here can be read as a project id.
 *
 * Every route needs VIEW_PROJECT_FINANCIALS: labour cost is priced from pay.
 */
@Controller('project-costing')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectCostingController {
    constructor(private readonly costing: ProjectCostingService) {}

    @Get('settings')
    @RequireStorePermission(StorePermission.VIEW_PROJECT_FINANCIALS)
    getSettings(@Tenant() tenant: TenantContext) {
        return this.costing.getSettings(tenant.tenantId);
    }

    @Put('settings')
    @RequireStorePermission(StorePermission.VIEW_PROJECT_FINANCIALS, StorePermission.MANAGE_PROJECT_SETTINGS)
    updateSettings(@Tenant() tenant: TenantContext, @Body() dto: CostingSettingsDto, @Request() req: any) {
        return this.costing.updateSettings(tenant.tenantId, dto, { userId: tenant.userId, ...extractRequestMeta(req) });
    }

    @Get('projects/:projectId')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    financials(@Tenant() tenant: TenantContext, @Param('projectId') projectId: string) {
        return this.costing.financials(tenant, projectId);
    }

    @Post('projects/:projectId/price-hours')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    @HttpCode(HttpStatus.OK)
    priceHours(@Tenant() tenant: TenantContext, @Param('projectId') projectId: string, @Request() req: any) {
        return this.costing.priceUncosted(tenant, projectId, { userId: tenant.userId, ...extractRequestMeta(req) });
    }
}
