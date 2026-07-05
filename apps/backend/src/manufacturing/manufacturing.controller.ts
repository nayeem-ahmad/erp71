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
    DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { PlatformFeatureGuard } from '../platform-settings/platform-feature.guard';
import { RequiresPlatformFeature } from '../platform-settings/platform-feature.decorator';
import { PaginationDto } from '../common/pagination.dto';
import { ManufacturingService } from './manufacturing.service';
import {
    CreateBomDto,
    UpdateBomDto,
    CreateProductionJobDto,
    CompleteProductionJobDto,
} from './manufacturing.dto';

@Controller('manufacturing')
@UseGuards(JwtAuthGuard, SubscriptionAccessGuard, PlatformFeatureGuard)
@RequiresPlan('PREMIUM')
@RequiresPlatformFeature('manufacturing')
@UseInterceptors(TenantInterceptor)
export class ManufacturingController {
    constructor(private readonly manufacturingService: ManufacturingService) {}

    // ------------------------------------------------------------------ //
    //  BOM Routes                                                          //
    // ------------------------------------------------------------------ //

    @Get('bom')
    listBoms(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.manufacturingService.listBoms(tenant.tenantId, query.page, query.limit);
    }

    @Get('bom/:id')
    getBom(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.getBom(tenant.tenantId, id);
    }

    @Get('bom/:id/requirements')
    getRequirements(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('quantity', new DefaultValuePipe(1), ParseIntPipe) quantity: number,
    ) {
        return this.manufacturingService.getRequirementsPreview(tenant.tenantId, id, Math.max(1, quantity));
    }

    @Post('bom')
    @HttpCode(HttpStatus.CREATED)
    createBom(@Tenant() tenant: TenantContext, @Body() dto: CreateBomDto) {
        return this.manufacturingService.createBom(tenant.tenantId, dto);
    }

    @Patch('bom/:id')
    updateBom(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateBomDto,
    ) {
        return this.manufacturingService.updateBom(tenant.tenantId, id, dto);
    }

    @Delete('bom/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteBom(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.deleteBom(tenant.tenantId, id);
    }

    // ------------------------------------------------------------------ //
    //  Production Job Routes                                               //
    // ------------------------------------------------------------------ //

    @Get('jobs')
    listJobs(
        @Tenant() tenant: TenantContext,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
        @Query('status') status?: string,
    ) {
        return this.manufacturingService.listJobs(tenant.tenantId, page, Math.min(limit, 100), status);
    }

    @Get('jobs/:id')
    getJob(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.getJob(tenant.tenantId, id);
    }

    @Post('jobs')
    @HttpCode(HttpStatus.CREATED)
    createJob(@Tenant() tenant: TenantContext, @Body() dto: CreateProductionJobDto) {
        return this.manufacturingService.createJob(tenant.tenantId, dto);
    }

    @Post('jobs/:id/start')
    startJob(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.startJob(tenant.tenantId, id);
    }

    @Post('jobs/:id/complete')
    completeJob(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CompleteProductionJobDto,
    ) {
        return this.manufacturingService.completeJob(tenant.tenantId, id, dto?.wastage ?? []);
    }

    @Post('jobs/:id/cancel')
    cancelJob(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.manufacturingService.cancelJob(tenant.tenantId, id);
    }

    // ------------------------------------------------------------------ //
    //  Analytics                                                           //
    // ------------------------------------------------------------------ //

    @Get('analytics')
    getAnalytics(@Tenant() tenant: TenantContext) {
        return this.manufacturingService.getAnalytics(tenant.tenantId);
    }
}
