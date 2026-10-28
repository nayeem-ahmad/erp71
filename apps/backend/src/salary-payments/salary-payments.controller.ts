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
import { BranchScopeService } from '../database/branch-scope.service';
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
    constructor(
        private readonly service: SalaryPaymentsService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...PAYROLL_READ)
    @Get()
    async list(@Tenant() tenant: TenantContext, @Query() query: ListSalaryPaymentsQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, undefined, { permissions: PAYROLL_READ });
        return this.service.list(tenant.tenantId, { ...query, storeId });
    }

    @RequireAnyStorePermission(...PAYROLL_READ)
    @Get('summary')
    async getSummary(@Tenant() tenant: TenantContext, @Query() query: SalaryPaymentSummaryQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, undefined, { permissions: PAYROLL_READ });
        return this.service.getSummary(tenant.tenantId, { ...query, storeId });
    }

    @RequireAnyStorePermission(...PAYROLL_READ)
    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const storeId = await this.branchScope.resolveStoreId(tenant, undefined, { permissions: PAYROLL_READ });
        return this.service.findOne(tenant.tenantId, id, storeId);
    }

    @RequireAnyStorePermission(...PAYROLL_WRITE)
    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSalaryPaymentDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, undefined, { permissions: PAYROLL_WRITE });
        return this.service.create(tenant.tenantId, tenant.userId, dto, storeId);
    }

    @RequireAnyStorePermission(...PAYROLL_POST)
    @Post('run-accrual')
    async runAccrual(@Tenant() tenant: TenantContext, @Body() dto: RunSalaryAccrualDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, dto.storeId, {
            permissions: PAYROLL_POST,
        });
        return this.service.runMonthlyAccrual(tenant.tenantId, tenant.userId, { ...dto, storeId });
    }

    @RequireAnyStorePermission(...PAYROLL_WRITE)
    @Patch(':id')
    async update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateSalaryPaymentDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, undefined, { permissions: PAYROLL_WRITE });
        return this.service.update(tenant.tenantId, id, dto, storeId);
    }

    @RequireAnyStorePermission(...PAYROLL_WRITE)
    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const storeId = await this.branchScope.resolveStoreId(tenant, undefined, { permissions: PAYROLL_WRITE });
        return this.service.remove(tenant.tenantId, id, storeId);
    }
}
