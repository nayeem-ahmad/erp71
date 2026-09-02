import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    GetBranchReportDto,
    GetConsolidatedReportDto,
    GetCostCoverageDto,
    GetCustomerRetentionDto,
    GetGrossProfitBySalespersonDto,
    GetMarginBridgeDto,
    GetMarginExceptionsDto,
    GetMonthlySalesByCustomerDto,
    GetReturnsAnalysisDto,
    GetSalesBreakdownDto,
    GetSalesByCategoryDto,
    GetSalesByCustomerDto,
    GetSalesByProductDto,
    GetSalesSummaryDto,
    GetSalesTrendDto,
    GetTopMoversDto,
} from './sales-reports.dto';
import { SalesReportsService } from './sales-reports.service';

@Controller('sales-reports')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class SalesReportsController {
    constructor(private readonly service: SalesReportsService) {}

    @Get('summary')
    getSalesSummary(@Tenant() tenant: TenantContext, @Query() query: GetSalesSummaryDto) {
        return this.service.getSalesSummary(tenant.tenantId, query, tenant.timezone);
    }

    @Get('by-product')
    getSalesByProduct(@Tenant() tenant: TenantContext, @Query() query: GetSalesByProductDto) {
        return this.service.getSalesByProduct(tenant.tenantId, query);
    }

    @Get('by-category')
    getSalesByCategory(@Tenant() tenant: TenantContext, @Query() query: GetSalesByCategoryDto) {
        return this.service.getSalesByCategory(tenant.tenantId, query);
    }

    @Get('consolidated')
    @RequireStorePermission(StorePermission.VIEW_CONSOLIDATED_REPORTS)
    getConsolidatedReport(@Tenant() tenant: TenantContext, @Query() query: GetConsolidatedReportDto) {
        return this.service.getConsolidatedReport(tenant.tenantId, query);
    }

    @Get('branch-report')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getBranchReport(@Tenant() tenant: TenantContext, @Query() query: GetBranchReportDto) {
        return this.service.getBranchReport(tenant.tenantId, query);
    }

    @Get('by-customer')
    getSalesByCustomer(@Tenant() tenant: TenantContext, @Query() query: GetSalesByCustomerDto) {
        return this.service.getSalesByCustomer(tenant.tenantId, query);
    }

    @Get('monthly-by-customer')
    getMonthlySalesByCustomer(@Tenant() tenant: TenantContext, @Query() query: GetMonthlySalesByCustomerDto) {
        return this.service.getMonthlySalesByCustomer(tenant.tenantId, query);
    }

    @Get('trend')
    getSalesTrend(@Tenant() tenant: TenantContext, @Query() query: GetSalesTrendDto) {
        return this.service.getSalesTrend(tenant.tenantId, query, tenant.timezone);
    }

    @Get('breakdown')
    getSalesBreakdown(@Tenant() tenant: TenantContext, @Query() query: GetSalesBreakdownDto) {
        return this.service.getSalesBreakdown(tenant.tenantId, query, tenant.timezone);
    }

    @Get('top-movers')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getTopMovers(@Tenant() tenant: TenantContext, @Query() query: GetTopMoversDto) {
        return this.service.getTopMovers(tenant.tenantId, query, tenant.timezone);
    }

    @Get('returns-analysis')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getReturnsAnalysis(@Tenant() tenant: TenantContext, @Query() query: GetReturnsAnalysisDto) {
        return this.service.getReturnsAnalysis(tenant.tenantId, query, tenant.timezone);
    }

    @Get('customer-retention')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    getCustomerRetention(@Tenant() tenant: TenantContext, @Query() query: GetCustomerRetentionDto) {
        return this.service.getCustomerRetention(tenant.tenantId, query);
    }

    // ── Gross profit ─────────────────────────────────────────────────────────
    // All behind VIEW_FINANCIAL_REPORTS: these expose what the business pays
    // for its stock, which is not the same thing as what it sells it for and
    // should not follow the same permission.

    @Get('gross-profit/by-product')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getGrossProfitByProduct(@Tenant() tenant: TenantContext, @Query() query: GetSalesByProductDto) {
        return this.service.getGrossProfitByProduct(tenant.tenantId, query);
    }

    @Get('gross-profit/by-salesperson')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getGrossProfitBySalesperson(
        @Tenant() tenant: TenantContext,
        @Query() query: GetGrossProfitBySalespersonDto,
    ) {
        return this.service.getGrossProfitBySalesperson(tenant.tenantId, query);
    }

    @Get('gross-profit/exceptions')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getMarginExceptions(@Tenant() tenant: TenantContext, @Query() query: GetMarginExceptionsDto) {
        return this.service.getMarginExceptions(tenant.tenantId, query);
    }

    @Get('gross-profit/bridge')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getMarginBridge(@Tenant() tenant: TenantContext, @Query() query: GetMarginBridgeDto) {
        return this.service.getMarginBridge(tenant.tenantId, query);
    }

    @Get('gross-profit/cost-coverage')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getCostCoverage(@Tenant() tenant: TenantContext, @Query() query: GetCostCoverageDto) {
        return this.service.getCostCoverage(tenant.tenantId, query);
    }
}
