import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { GetConsolidatedReportDto, GetMonthlySalesByCustomerDto, GetSalesByCustomerDto, GetSalesByProductDto, GetSalesSummaryDto } from './sales-reports.dto';
import { SalesReportsService } from './sales-reports.service';

@Controller('sales-reports')
@UseGuards(JwtAuthGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class SalesReportsController {
    constructor(private readonly service: SalesReportsService) {}

    @Get('summary')
    getSalesSummary(@Tenant() tenant: TenantContext, @Query() query: GetSalesSummaryDto) {
        return this.service.getSalesSummary(tenant.tenantId, query);
    }

    @Get('by-product')
    getSalesByProduct(@Tenant() tenant: TenantContext, @Query() query: GetSalesByProductDto) {
        return this.service.getSalesByProduct(tenant.tenantId, query);
    }

    @Get('consolidated')
    getConsolidatedReport(@Tenant() tenant: TenantContext, @Query() query: GetConsolidatedReportDto) {
        return this.service.getConsolidatedReport(tenant.tenantId, query);
    }

    @Get('by-customer')
    getSalesByCustomer(@Tenant() tenant: TenantContext, @Query() query: GetSalesByCustomerDto) {
        return this.service.getSalesByCustomer(tenant.tenantId, query);
    }

    @Get('monthly-by-customer')
    getMonthlySalesByCustomer(@Tenant() tenant: TenantContext, @Query() query: GetMonthlySalesByCustomerDto) {
        return this.service.getMonthlySalesByCustomer(tenant.tenantId, query);
    }
}
