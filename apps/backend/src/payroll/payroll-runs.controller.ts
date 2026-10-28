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
import { BranchScopeService } from '../database/branch-scope.service';
import { PayrollRunsService, type PayrollBranchAccess } from './payroll-runs.service';
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
        private readonly branchScope: BranchScopeService,
    ) {}

    /** Header branch for a member; company view for someone who can see every branch. */
    private async access(tenant: TenantContext, permissions: StorePermission[]): Promise<PayrollBranchAccess> {
        const [storeId, consolidated] = await Promise.all([
            this.branchScope.resolveStoreId(tenant, undefined, { permissions }),
            this.branchScope.canSeeAllBranches(tenant),
        ]);
        return { consolidated, storeId };
    }

    @Get()
    async list(@Tenant() tenant: TenantContext, @Query() query: PayrollRunQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, {
            permissions: [StorePermission.VIEW_PAYROLL],
        });
        return this.service.list(tenant.tenantId, { ...query, storeId });
    }

    @Get('adjustments')
    async listAdjustments(@Tenant() tenant: TenantContext, @Query() query: PayrollPeriodDto) {
        const access = await this.access(tenant, [StorePermission.VIEW_PAYROLL]);
        return this.service.listAdjustments(tenant.tenantId, query.year, query.month, access);
    }

    @Post('adjustments')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    async createAdjustment(@Tenant() tenant: TenantContext, @Body() dto: CreatePayrollAdjustmentDto) {
        const access = await this.access(tenant, [StorePermission.MANAGE_HR]);
        return this.service.createAdjustment(tenant.tenantId, dto as any, tenant.userId, access);
    }

    @Delete('adjustments/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteAdjustment(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const access = await this.access(tenant, [StorePermission.MANAGE_HR]);
        return this.service.deleteAdjustment(tenant.tenantId, id, access);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_HR)
    async createDraft(@Tenant() tenant: TenantContext, @Body() dto: CreatePayrollRunDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, dto.storeId, {
            permissions: [StorePermission.MANAGE_HR],
            allowAll: false,
        });
        return this.service.createDraft(
            tenant.tenantId,
            { ...dto, storeId: storeId ?? dto.storeId },
            tenant.userId,
        );
    }

    @Get(':id')
    async get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const access = await this.access(tenant, [StorePermission.VIEW_PAYROLL]);
        return this.service.get(tenant.tenantId, id, access);
    }

    @Get(':id/payslips/:employeeId')
    async getPayslip(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('employeeId') employeeId: string,
    ) {
        const access = await this.access(tenant, [StorePermission.VIEW_PAYROLL]);
        return this.service.getPayslip(tenant.tenantId, id, employeeId, access);
    }

    @Post(':id/recompute')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    async recompute(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const access = await this.access(tenant, [StorePermission.MANAGE_HR]);
        return this.service.recompute(tenant.tenantId, id, access);
    }

    @Patch(':id/approve')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    async approve(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const access = await this.access(tenant, [StorePermission.MANAGE_HR]);
        return this.service.approve(tenant.tenantId, id, tenant.userId, access);
    }

    @Patch(':id/reopen')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    async reopen(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const access = await this.access(tenant, [StorePermission.MANAGE_HR]);
        return this.service.reopen(tenant.tenantId, id, access);
    }

    @Get(':id/disbursement-file')
    async disbursementFile(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const access = await this.access(tenant, [StorePermission.VIEW_PAYROLL]);
        return this.disbursement.buildDisbursementFile(tenant.tenantId, id, access);
    }

    @Post(':id/disburse')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    async disburse(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: DisbursePayrollDto,
    ) {
        const access = await this.access(tenant, [StorePermission.MANAGE_HR]);
        return this.disbursement.disburse(tenant.tenantId, id, tenant.userId, dto, access);
    }

    @Patch(':id/cancel')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    async cancel(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const access = await this.access(tenant, [StorePermission.MANAGE_HR]);
        return this.service.cancel(tenant.tenantId, id, access);
    }
}
