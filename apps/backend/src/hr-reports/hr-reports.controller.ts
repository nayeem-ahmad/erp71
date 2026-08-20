import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { HrReportsService } from './hr-reports.service';
import { HrReportMonthRangeDto, LeaveBalanceReportDto } from './hr-reports.dto';

/**
 * Management HR reports.
 *
 * Permission is per-route rather than per-controller, which the statutory
 * controller does not need to do because everything there is pay. Here the
 * split is the point: attendance and leave *days* are `VIEW_HR`, so an HR
 * officer with no pay access can still run them, while payroll cost is
 * `VIEW_PAYROLL`.
 *
 * The leave report sits in between — days for everyone, money only for
 * `VIEW_PAYROLL` — so it is gated `VIEW_HR` here and drops the money columns
 * inside the service rather than refusing the whole request.
 */
@Controller('hr-reports')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class HrReportsController {
    constructor(private readonly service: HrReportsService) {}

    @Get('attendance-summary')
    @RequireStorePermission(StorePermission.VIEW_HR)
    attendanceSummary(@Tenant() tenant: TenantContext, @Query() query: HrReportMonthRangeDto) {
        return this.service.attendanceSummary(tenant.tenantId, query);
    }

    @Get('leave-balance')
    @RequireStorePermission(StorePermission.VIEW_HR)
    leaveBalance(@Tenant() tenant: TenantContext, @Query() query: LeaveBalanceReportDto) {
        return this.service.leaveBalance(tenant, query);
    }

    @Get('payroll-cost')
    @RequireStorePermission(StorePermission.VIEW_PAYROLL)
    payrollCost(@Tenant() tenant: TenantContext, @Query() query: HrReportMonthRangeDto) {
        return this.service.payrollCost(tenant.tenantId, query);
    }
}
