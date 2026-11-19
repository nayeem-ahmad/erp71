import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Request, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission, RequireStorePermission } from '../auth/store-permission.decorator';
import { EXPENSE_WRITE, SHRINKAGE_STAFF } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { extractRequestMeta } from '../audit/audit-route.util';
import { ProjectCostingService } from './project-costing.service';
import { ProjectDirectCostsService } from './project-direct-costs.service';
import { CostingSettingsDto, CostSourcesQueryDto, CreateProjectCostDto, IssueMaterialsDto } from './project.dto';

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
    constructor(
        private readonly costing: ProjectCostingService,
        private readonly direct: ProjectDirectCostsService,
    ) {}

    /**
     * Projects to tag an expense with. Not behind VIEW_PROJECT_FINANCIALS: the
     * person recording an expense needs the list, not the money. Visibility
     * still decides which projects they are shown.
     */
    @Get('project-options')
    @RequireAnyStorePermission(StorePermission.VIEW_PROJECTS, ...EXPENSE_WRITE)
    projectOptions(@Tenant() tenant: TenantContext) {
        return this.direct.options(tenant);
    }

    @Get('cost-sources')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    costSources(@Tenant() tenant: TenantContext, @Query() query: CostSourcesQueryDto) {
        return this.direct.costSources(tenant.tenantId, query.search);
    }

    @Get('projects/:projectId/costs')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    listCosts(@Tenant() tenant: TenantContext, @Param('projectId') projectId: string) {
        return this.direct.list(tenant, projectId);
    }

    @Post('projects/:projectId/costs')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    addCost(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Body() dto: CreateProjectCostDto,
        @Request() req: any,
    ) {
        return this.direct.addCost(tenant, projectId, dto, { userId: tenant.userId, ...extractRequestMeta(req) });
    }

    @Delete('projects/:projectId/costs/:costId')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    @HttpCode(HttpStatus.OK)
    removeCost(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Param('costId') costId: string,
        @Request() req: any,
    ) {
        return this.direct.removeCost(tenant, projectId, costId, { userId: tenant.userId, ...extractRequestMeta(req) });
    }

    // Issuing moves stock, so it also needs what a stock write-off needs.
    @Post('projects/:projectId/material-issues')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    @RequireAnyStorePermission(...SHRINKAGE_STAFF)
    issueMaterials(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Body() dto: IssueMaterialsDto,
        @Request() req: any,
    ) {
        return this.direct.issueMaterials(tenant, projectId, dto, { userId: tenant.userId, ...extractRequestMeta(req) });
    }

    @Delete('projects/:projectId/material-issues/:issueId')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    @RequireAnyStorePermission(...SHRINKAGE_STAFF)
    @HttpCode(HttpStatus.OK)
    reverseIssue(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Param('issueId') issueId: string,
        @Request() req: any,
    ) {
        return this.direct.reverseIssue(tenant, projectId, issueId, { userId: tenant.userId, ...extractRequestMeta(req) });
    }

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
