import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
    UseGuards, UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollDisbursementService } from './payroll-disbursement.service';
import {
    CreatePayrollAdjustmentDto, CreatePayrollRunDto, DisbursePayrollDto,
    PayrollPeriodDto, PayrollRunQueryDto,
} from './payroll.dto';

/**
 * Running payroll is seeing everybody's pay, so the whole controller needs
 * `VIEW_PAYROLL`; changing anything needs `MANAGE_HR` on top.
 */
@Controller('payroll/runs')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_PAYROLL)
@UseInterceptors(TenantInterceptor)
export class PayrollRunsController {
    constructor(
        private readonly service: PayrollRunsService,
        private readonly disbursement: PayrollDisbursementService,
    ) {}

    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: PayrollRunQueryDto) {
        return this.service.list(tenant.tenantId, query);
    }

    @Get('adjustments')
    listAdjustments(@Tenant() tenant: TenantContext, @Query() query: PayrollPeriodDto) {
        return this.service.listAdjustments(tenant.tenantId, query.year, query.month);
    }

    @Post('adjustments')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createAdjustment(@Tenant() tenant: TenantContext, @Body() dto: CreatePayrollAdjustmentDto) {
        return this.service.createAdjustment(tenant.tenantId, dto as any, tenant.userId);
    }

    @Delete('adjustments/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteAdjustment(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteAdjustment(tenant.tenantId, id);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createDraft(@Tenant() tenant: TenantContext, @Body() dto: CreatePayrollRunDto) {
        return this.service.createDraft(tenant.tenantId, dto as any, tenant.userId);
    }

    @Get(':id')
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.get(tenant.tenantId, id);
    }

    @Get(':id/payslips/:employeeId')
    getPayslip(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('employeeId') employeeId: string,
    ) {
        return this.service.getPayslip(tenant.tenantId, id, employeeId);
    }

    @Post(':id/recompute')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    recompute(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.recompute(tenant.tenantId, id);
    }

    @Patch(':id/approve')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    approve(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.approve(tenant.tenantId, id, tenant.userId);
    }

    @Patch(':id/reopen')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    reopen(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.reopen(tenant.tenantId, id);
    }

    @Get(':id/disbursement-file')
    disbursementFile(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.disbursement.buildDisbursementFile(tenant.tenantId, id);
    }

    @Post(':id/disburse')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    disburse(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: DisbursePayrollDto,
    ) {
        return this.disbursement.disburse(tenant.tenantId, id, tenant.userId, dto);
    }

    @Patch(':id/cancel')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    cancel(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.cancel(tenant.tenantId, id);
    }
}
