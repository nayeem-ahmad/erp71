import { Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission, RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateCostAdjustmentsDto, ListCostAdjustmentsDto, ListProductCostsDto } from './product-costs.dto';
import { ProductCostsService } from './product-costs.service';

/**
 * Reading what stock cost is financial information and follows the
 * gross-profit reports' permission; stating it needs ADJUST_PRODUCT_COST,
 * because it moves the COGS of every later sale of the product.
 *
 * Tenant-wide, with no branch filter: the cost pool is one per product across
 * every warehouse, so there is no per-branch answer to give.
 */
@Controller('product-costs')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProductCostsController {
    constructor(private readonly service: ProductCostsService) {}

    @Get()
    @RequireAnyStorePermission(StorePermission.ADJUST_PRODUCT_COST, StorePermission.VIEW_FINANCIAL_REPORTS)
    list(@Tenant() tenant: TenantContext, @Query() query: ListProductCostsDto) {
        return this.service.list(tenant.tenantId, query);
    }

    @Get('adjustments')
    @RequireAnyStorePermission(StorePermission.ADJUST_PRODUCT_COST, StorePermission.VIEW_FINANCIAL_REPORTS)
    history(@Tenant() tenant: TenantContext, @Query() query: ListCostAdjustmentsDto) {
        return this.service.history(tenant.tenantId, query);
    }

    @Post('adjustments')
    @RequireStorePermission(StorePermission.ADJUST_PRODUCT_COST)
    adjust(@Tenant() tenant: TenantContext, @Body() dto: CreateCostAdjustmentsDto) {
        return this.service.adjust(tenant.tenantId, tenant.userId, dto);
    }
}
