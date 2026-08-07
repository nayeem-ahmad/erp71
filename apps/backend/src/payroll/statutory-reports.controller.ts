import { Controller, Get, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { StatutoryReportsService } from './statutory-reports.service';
import { PayrollPeriodDto } from './payroll.dto';

/**
 * Statutory registers. Everything here is per-employee pay, so the whole
 * controller needs `VIEW_PAYROLL`.
 *
 * The employee register is the one exception in spirit — it is roster data —
 * but it lives here because it is produced for the same inspection as the rest,
 * and splitting it across two permissions would mean an inspection pack nobody
 * has the rights to assemble in one go.
 */
@Controller('payroll/statutory')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_PAYROLL)
@UseInterceptors(TenantInterceptor)
export class StatutoryReportsController {
    constructor(private readonly service: StatutoryReportsService) {}

    /** `startYear` is the July the income year opens in — 2026 means 2026-27. */
    @Get('provident-fund')
    providentFund(@Tenant() tenant: TenantContext, @Query('startYear') startYear: string) {
        return this.service.providentFundRegister(tenant.tenantId, parseInt(startYear, 10));
    }

    @Get('tax-deduction')
    taxDeduction(
        @Tenant() tenant: TenantContext,
        @Query('startYear') startYear: string,
        @Query('employeeId') employeeId?: string,
    ) {
        return this.service.taxDeductionStatement(tenant.tenantId, parseInt(startYear, 10), employeeId);
    }

    @Get('wages-register')
    wagesRegister(@Tenant() tenant: TenantContext, @Query() query: PayrollPeriodDto) {
        return this.service.wagesRegister(tenant.tenantId, query.year, query.month);
    }

    @Get('employee-register')
    employeeRegister(@Tenant() tenant: TenantContext) {
        return this.service.employeeRegister(tenant.tenantId);
    }

    @Get('service-book/:employeeId')
    serviceBook(@Tenant() tenant: TenantContext, @Param('employeeId') employeeId: string) {
        return this.service.serviceBook(tenant.tenantId, employeeId);
    }
}
