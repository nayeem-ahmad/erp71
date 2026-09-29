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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    CreateSalaryPaymentDto,
    ListSalaryPaymentsQueryDto,
    RunSalaryAccrualDto,
    SalaryPaymentSummaryQueryDto,
    UpdateSalaryPaymentDto,
} from './salary-payments.dto';
import { SalaryPaymentsService } from './salary-payments.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PAYROLL_POST, PAYROLL_READ, PAYROLL_WRITE } from '../auth/permission-sets';
@Controller('salary-payments')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SalaryPaymentsController {
    constructor(private readonly service: SalaryPaymentsService) {}

    @RequireAnyStorePermission(...PAYROLL_READ)
    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: ListSalaryPaymentsQueryDto) {
        return this.service.list(tenant.tenantId, query);
    }

    @RequireAnyStorePermission(...PAYROLL_READ)
    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext, @Query() query: SalaryPaymentSummaryQueryDto) {
        return this.service.getSummary(tenant.tenantId, query);
    }

    @RequireAnyStorePermission(...PAYROLL_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PAYROLL_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateSalaryPaymentDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...PAYROLL_POST)
    @Post('run-accrual')
    runAccrual(@Tenant() tenant: TenantContext, @Body() dto: RunSalaryAccrualDto) {
        return this.service.runMonthlyAccrual(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...PAYROLL_WRITE)
    @Patch(':id')
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateSalaryPaymentDto,
    ) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...PAYROLL_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
