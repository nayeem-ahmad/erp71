import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
    UseInterceptors,
    HttpCode,
    HttpStatus,
    ParseIntPipe,
    ParseFloatPipe,
    DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { PlatformFeatureGuard } from '../platform-settings/platform-feature.guard';
import { RequiresPlatformFeature } from '../platform-settings/platform-feature.decorator';
import { PaginationDto } from '../common/pagination.dto';
import { ManufacturingService } from './manufacturing.service';
import {
    CreateBomDto,
    UpdateBomDto,
    CreateProductionJobDto,
    CompleteProductionJobDto,
    CreateJobCostDto,
    ApplySuggestedPriceDto,
} from './manufacturing.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { MANUFACTURING_PRICE, MANUFACTURING_READ, MANUFACTURING_WRITE } from '../auth/permission-sets';
@Controller('manufacturing')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard, PlatformFeatureGuard)
@RequiresFeature('premiumManufacturing')
@RequiresPlatformFeature('manufacturing')
@UseInterceptors(TenantInterceptor)
export class ManufacturingController {
    constructor(private readonly manufacturingService: ManufacturingService) {}

    // ------------------------------------------------------------------ //
    //  BOM Routes                                                          //
    // ------------------------------------------------------------------ //

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('bom')
    listBoms(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.manufacturingService.listBoms(tenant.tenantId, query.page, query.limit);
    }

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('bom/:id')
    getBom(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.getBom(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('bom/:id/requirements')
    getRequirements(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('quantity', new DefaultValuePipe(1), ParseIntPipe) quantity: number,
    ) {
        return this.manufacturingService.getRequirementsPreview(tenant.tenantId, id, Math.max(1, quantity));
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Post('bom')
    @HttpCode(HttpStatus.CREATED)
    createBom(@Tenant() tenant: TenantContext, @Body() dto: CreateBomDto) {
        return this.manufacturingService.createBom(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Patch('bom/:id')
    updateBom(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateBomDto,
    ) {
        return this.manufacturingService.updateBom(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Delete('bom/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteBom(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.deleteBom(tenant.tenantId, id);
    }

    // ------------------------------------------------------------------ //
    //  Production Job Routes                                               //
    // ------------------------------------------------------------------ //

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('jobs')
    listJobs(
        @Tenant() tenant: TenantContext,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
        @Query('status') status?: string,
    ) {
        return this.manufacturingService.listJobs(tenant.tenantId, page, Math.min(limit, 100), status);
    }

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('jobs/:id')
    getJob(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.getJob(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Post('jobs')
    @HttpCode(HttpStatus.CREATED)
    createJob(@Tenant() tenant: TenantContext, @Body() dto: CreateProductionJobDto) {
        return this.manufacturingService.createJob(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Post('jobs/:id/start')
    startJob(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.startJob(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Post('jobs/:id/complete')
    completeJob(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CompleteProductionJobDto,
    ) {
        return this.manufacturingService.completeJob(tenant.tenantId, id, dto?.wastage ?? []);
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Post('jobs/:id/cancel')
    cancelJob(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.cancelJob(tenant.tenantId, id);
    }

    // ------------------------------------------------------------------ //
    //  Job cost lines                                                      //
    // ------------------------------------------------------------------ //

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('cost-sources')
    listCostSources(
        @Tenant() tenant: TenantContext,
        @Query('search') search?: string,
        @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    ) {
        return this.manufacturingService.listCostSources(tenant.tenantId, search, limit);
    }

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('jobs/:id/costs')
    listJobCosts(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.listJobCosts(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Post('jobs/:id/costs')
    @HttpCode(HttpStatus.CREATED)
    addJobCost(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateJobCostDto,
    ) {
        return this.manufacturingService.addJobCost(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...MANUFACTURING_WRITE)
    @Delete('jobs/:id/costs/:costId')
    removeJobCost(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('costId') costId: string,
    ) {
        return this.manufacturingService.removeJobCost(tenant.tenantId, id, costId);
    }

    // ------------------------------------------------------------------ //
    //  Cost-plus pricing                                                   //
    // ------------------------------------------------------------------ //

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('jobs/:id/pricing-suggestion')
    getPricingSuggestion(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('marginPct', new DefaultValuePipe(30), ParseFloatPipe) marginPct: number,
    ) {
        return this.manufacturingService.getPricingSuggestion(tenant.tenantId, id, marginPct);
    }

    @RequireAnyStorePermission(...MANUFACTURING_PRICE)
    @Post('jobs/:id/apply-price')
    applySuggestedPrice(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ApplySuggestedPriceDto,
    ) {
        return this.manufacturingService.applySuggestedPrice(tenant.tenantId, id, dto.marginPct);
    }

    // ------------------------------------------------------------------ //
    //  Analytics                                                           //
    // ------------------------------------------------------------------ //

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('analytics')
    getAnalytics(@Tenant() tenant: TenantContext) {
        return this.manufacturingService.getAnalytics(tenant.tenantId, tenant.timezone);
    }

    @RequireAnyStorePermission(...MANUFACTURING_READ)
    @Get('reports/product-pl')
    getProductPL(@Tenant() tenant: TenantContext) {
        return this.manufacturingService.getProductPL(tenant.tenantId);
    }
}
