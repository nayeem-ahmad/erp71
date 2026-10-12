import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    AllocateSupplierPaymentDto,
    CreateSupplierDto,
    ListSupplierCreditPaymentsQueryDto,
    NextSupplierPaymentNumberQueryDto,
    RecordSupplierCreditPaymentDto,
    SupplierCreditLedgerQueryDto,
    UpdateSupplierCreditPaymentDto,
    UpdateSupplierDto,
    ListSuppliersQueryDto,
} from './supplier.dto';
import { SuppliersService } from './suppliers.service';
import { SupplierScopeService } from './supplier-scope.service';
import { BranchScopeService } from '../database/branch-scope.service';
import { ImportRowsDto } from '../common/import.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SUPPLIER_CREDIT_READ, SUPPLIER_CREDIT_WRITE, SUPPLIER_READ, SUPPLIER_WRITE } from '../auth/permission-sets';
// Every route reads and writes only the suppliers the member may see — see
// `supplier-visibility.ts`. A supplier outside that is a 404, never a 403, so
// another branch's supplier cannot be told from no supplier.
@Controller('suppliers')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SuppliersController {
    constructor(
        private readonly suppliersService: SuppliersService,
        private readonly supplierScope: SupplierScopeService,
        private readonly branchScope: BranchScopeService,
    ) {}

    private scope(tenant: TenantContext, requested?: string) {
        return this.supplierScope.resolve(tenant, requested);
    }

    @RequireAnyStorePermission(...SUPPLIER_WRITE)
    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSupplierDto) {
        return this.suppliersService.create(tenant.tenantId, dto, {
            storeId: tenant.storeId,
            scope: await this.scope(tenant),
        });
    }

    @RequireAnyStorePermission(...SUPPLIER_WRITE)
    @Post('import')
    async importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        // The file's branch: the one picked in the import dialog — checked like
        // any requested branch — else the header branch.
        const fileBranch = body.storeId
            ? await this.branchScope.resolveStoreId(tenant, body.storeId, { permissions: SUPPLIER_WRITE, allowAll: false })
            : tenant.storeId;
        return this.suppliersService.importRows(tenant.tenantId, body.rows, body.mode, fileBranch, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_READ)
    @Get()
    async findAll(@Tenant() tenant: TenantContext, @Query() query: ListSuppliersQueryDto) {
        return this.suppliersService.findAll(tenant.tenantId, query.page, query.limit, {
            search: query.search,
            sortBy: query.sortBy,
            sortDir: query.sortDir,
            scope: await this.scope(tenant, query.storeId),
        });
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get('credit/payments')
    async listCreditPayments(
        @Tenant() tenant: TenantContext,
        @Query() query: ListSupplierCreditPaymentsQueryDto,
    ) {
        const { storeId, ...rest } = query;
        return this.suppliersService.listCreditPayments(tenant.tenantId, {
            ...rest,
            timezone: tenant.timezone,
            // The page's branch filter, under the same rule as every branch-aware list.
            branch: await this.branchScope.resolveStoreId(tenant, storeId, { permissions: SUPPLIER_CREDIT_READ }),
            scope: await this.scope(tenant),
        });
    }

    /** The serial a new payment would get. Declared before `:paymentId` so it is not captured as one. */
    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Get('credit/payments/next-number')
    getNextPaymentNumber(
        @Tenant() tenant: TenantContext,
        @Query() query: NextSupplierPaymentNumberQueryDto,
    ) {
        return this.suppliersService.getNextPaymentNumber(tenant.tenantId, query.direction);
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get('credit/payments/:paymentId')
    async getCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.suppliersService.getCreditPayment(tenant.tenantId, paymentId, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Patch('credit/payments/:paymentId')
    async updateCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
        @Body() dto: UpdateSupplierCreditPaymentDto,
    ) {
        return this.suppliersService.updateCreditPayment(tenant.tenantId, paymentId, dto, tenant.timezone, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Delete('credit/payments/:paymentId')
    async deleteCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.suppliersService.deleteCreditPayment(tenant.tenantId, paymentId, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Post('credit/payments/:paymentId/allocate')
    async allocatePayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
        @Body() dto: AllocateSupplierPaymentDto,
    ) {
        return this.suppliersService.allocatePayment(tenant.tenantId, paymentId, dto, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Delete('credit/allocations/:allocationId')
    async removeAllocation(
        @Tenant() tenant: TenantContext,
        @Param('allocationId') allocationId: string,
    ) {
        return this.suppliersService.removeAllocation(tenant.tenantId, allocationId, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get(':id/billing-summary')
    async getBillingSummary(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
    ) {
        return this.suppliersService.getBillingSummary(tenant.tenantId, id, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get(':id/credit')
    async getCreditLedger(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query() query: SupplierCreditLedgerQueryDto,
    ) {
        return this.suppliersService.getCreditLedger(tenant.tenantId, id, {
            page: query.page,
            limit: query.limit,
            from: query.from,
            to: query.to,
        }, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get(':id/gl-ledger')
    async getGlLedger(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query() query: SupplierCreditLedgerQueryDto,
    ) {
        return this.suppliersService.getGlLedger(tenant.tenantId, id, { from: query.from, to: query.to }, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Post(':id/credit/payment')
    async recordCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: RecordSupplierCreditPaymentDto,
    ) {
        return this.suppliersService.recordCreditPayment(tenant.tenantId, id, tenant.userId, dto, tenant.timezone, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_READ)
    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.suppliersService.findOne(tenant.tenantId, id, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...SUPPLIER_WRITE)
    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
        return this.suppliersService.update(tenant.tenantId, id, dto, {
            scope: await this.scope(tenant),
            // Moving a supplier to another branch is an owner's call.
            canSetBranch: await this.supplierScope.canSeeAll(tenant),
        });
    }

    @RequireAnyStorePermission(...SUPPLIER_WRITE)
    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.suppliersService.remove(tenant.tenantId, id, await this.scope(tenant));
    }
}
