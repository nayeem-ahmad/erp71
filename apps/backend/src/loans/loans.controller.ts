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
    CreateLoanDto,
    CreateLoanPaymentDto,
    ListLoansQueryDto,
    LoanSummaryQueryDto,
    UpdateLoanDto,
} from './loans.dto';
import { LoansService } from './loans.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { LOANS_READ, LOANS_WRITE } from '../auth/permission-sets';
@Controller('loans')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class LoansController {
    constructor(
        private readonly service: LoansService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...LOANS_READ)
    @Get()
    async list(@Tenant() tenant: TenantContext, @Query() query: ListLoansQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: LOANS_READ });
        return this.service.listLoans(tenant.tenantId, { ...query, storeId, timezone: tenant.timezone });
    }

    @RequireAnyStorePermission(...LOANS_READ)
    @Get('summary')
    async getSummary(@Tenant() tenant: TenantContext, @Query() query: LoanSummaryQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: LOANS_READ });
        return this.service.getSummary(tenant.tenantId, storeId);
    }

    @RequireAnyStorePermission(...LOANS_READ)
    @Get(':id')
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getLoan(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...LOANS_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateLoanDto) {
        return this.service.createLoan(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...LOANS_WRITE)
    @Patch(':id')
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateLoanDto,
    ) {
        return this.service.updateLoan(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...LOANS_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteLoan(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...LOANS_WRITE)
    @Post(':id/payments')
    addPayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateLoanPaymentDto,
    ) {
        return this.service.addPayment(tenant.tenantId, tenant.userId, id, dto);
    }

    @RequireAnyStorePermission(...LOANS_WRITE)
    @Delete(':id/payments/:paymentId')
    deletePayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('paymentId') paymentId: string,
    ) {
        return this.service.deletePayment(tenant.tenantId, id, paymentId);
    }
}
