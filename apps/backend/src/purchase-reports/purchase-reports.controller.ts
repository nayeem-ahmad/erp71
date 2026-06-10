import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { GetPurchaseSummaryDto, GetPurchasesByProductDto, GetPurchasesBySupplierDto } from './purchase-reports.dto';
import { PurchaseReportsService } from './purchase-reports.service';

@Controller('purchase-reports')
@UseGuards(JwtAuthGuard, TenantRoleGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class PurchaseReportsController {
    constructor(private readonly service: PurchaseReportsService) {}

    @Get('summary')
    getPurchaseSummary(@Tenant() tenant: TenantContext, @Query() query: GetPurchaseSummaryDto) {
        return this.service.getPurchaseSummary(tenant.tenantId, query);
    }

    @Get('by-product')
    getPurchasesByProduct(@Tenant() tenant: TenantContext, @Query() query: GetPurchasesByProductDto) {
        return this.service.getPurchasesByProduct(tenant.tenantId, query);
    }

    @Get('by-supplier')
    getPurchasesBySupplier(@Tenant() tenant: TenantContext, @Query() query: GetPurchasesBySupplierDto) {
        return this.service.getPurchasesBySupplier(tenant.tenantId, query);
    }
}
