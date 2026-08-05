import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    CreateCapitalTxnDto,
    CreateInvestorDto,
    ListInvestorsQueryDto,
    ListProfitRunsQueryDto,
    PayProfitShareDto,
    ProfitRunDto,
    UpdateInvestorDto,
} from './investors.dto';
import { InvestorsService } from './investors.service';

/**
 * Reads need VIEW_INVESTORS; anything that moves money — capital in/out, a
 * profit run, a payout — needs MANAGE_INVESTORS instead. StorePermissionGuard
 * resolves with `getAllAndOverride`, so a method-level requirement REPLACES the
 * class-level one rather than adding to it: MANAGE alone is what the write
 * routes check, which is why every role seeded with MANAGE also carries VIEW.
 */
@Controller('investors')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_INVESTORS)
@UseInterceptors(TenantInterceptor)
export class InvestorsController {
    constructor(private readonly service: InvestorsService) {}

    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: ListInvestorsQueryDto) {
        return this.service.list(tenant.tenantId, query);
    }

    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext) {
        return this.service.getSummary(tenant.tenantId);
    }

    @Get('profit-runs')
    listProfitRuns(@Tenant() tenant: TenantContext, @Query() query: ListProfitRunsQueryDto) {
        return this.service.listProfitRuns(tenant.tenantId, query);
    }

    @Get('profit-runs/:id')
    getProfitRun(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getProfitRun(tenant.tenantId, id);
    }

    // Static segments are declared before ':id' so 'summary' and 'profit-runs'
    // are not swallowed by the parameterised route.
    @Get(':id')
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.get(tenant.tenantId, id);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateInvestorDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateInvestorDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }

    @Post(':id/capital')
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    addCapital(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateCapitalTxnDto,
    ) {
        return this.service.addCapitalTxn(tenant.tenantId, tenant.userId, id, dto);
    }

    @Delete(':id/capital/:txnId')
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    deleteCapital(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('txnId') txnId: string,
    ) {
        return this.service.deleteCapitalTxn(tenant.tenantId, id, txnId);
    }

    /** Dry run — shows what a month would allocate without writing anything. */
    @Post('profit-runs/preview')
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    previewProfitRun(@Tenant() tenant: TenantContext, @Body() dto: ProfitRunDto) {
        return this.service.previewProfitRun(tenant.tenantId, dto);
    }

    @Post('profit-runs')
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    createProfitRun(@Tenant() tenant: TenantContext, @Body() dto: ProfitRunDto) {
        return this.service.createProfitRun(tenant.tenantId, tenant.userId, dto);
    }

    @Delete('profit-runs/:id')
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    deleteProfitRun(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteProfitRun(tenant.tenantId, id);
    }

    @Post('shares/:shareId/pay')
    @RequireStorePermission(StorePermission.MANAGE_INVESTORS)
    payShare(
        @Tenant() tenant: TenantContext,
        @Param('shareId') shareId: string,
        @Body() dto: PayProfitShareDto,
    ) {
        return this.service.payShare(tenant.tenantId, shareId, dto);
    }
}
