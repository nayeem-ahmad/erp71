import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { SegmentsService } from './segments.service';
import { CustomerScopeService } from './customer-scope.service';
import {
    CreateCustomerDto,
    UpdateCustomerDto,
    RecordCreditPaymentDto,
    NextCustomerPaymentNumberQueryDto,
    UpdateCreditPaymentDto,
    ListCustomerCreditPaymentsQueryDto,
    WriteOffCustomerDebtDto,
    ListCustomerWriteOffsQueryDto,
} from './customer.dto';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission, RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ImportRowsDto } from '../common/import.dto';

import { CUSTOMER_CREDIT_READ, CUSTOMER_CREDIT_WRITE, CUSTOMER_READ, CUSTOMER_WRITE } from '../auth/permission-sets';
import { BranchScopeService } from '../database/branch-scope.service';
// `StorePermissionGuard` is class-wide but only the write-off routes name a
// permission, so every other route behaves exactly as before — the guard is a
// no-op without `@RequireStorePermission`. Same arrangement as
// sales.controller.ts and its cancel route.
//
// Every route reads and writes only the customers the member may see — see
// `customer-visibility.ts`. A customer outside that is a 404, never a 403, so
// another branch's customer cannot be told from no customer.
@Controller('customers')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CustomersController {
    constructor(
        private readonly customersService: CustomersService,
        private readonly segmentsService: SegmentsService,
        private readonly customerScope: CustomerScopeService,
        private readonly branchScope: BranchScopeService,
    ) {}

    private scope(tenant: TenantContext, requested?: string) {
        return this.customerScope.resolve(tenant, requested);
    }

    @RequireAnyStorePermission(...CUSTOMER_WRITE)
    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateCustomerDto) {
        return this.customersService.create(tenant.tenantId, dto, {
            storeId: tenant.storeId,
            scope: await this.scope(tenant),
        });
    }

    @RequireAnyStorePermission(...CUSTOMER_READ)
    @Get('segment-stats')
    async getSegmentStats(@Tenant() tenant: TenantContext, @Query('storeId') storeId?: string) {
        return this.customersService.getSegmentStats(tenant.tenantId, await this.scope(tenant, storeId));
    }

    @RequireAnyStorePermission(...CUSTOMER_WRITE)
    @Post('run-segmentation')
    async runSegmentation(@Tenant() tenant: TenantContext) {
        return this.segmentsService.runForTenant(tenant.tenantId);
    }

    @RequireAnyStorePermission(...CUSTOMER_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
        @Query('segment') segment?: string,
        @Query('customerType') customerType?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
        @Query('storeId') storeId?: string,
    ) {
        return this.customersService.findAll(tenant.tenantId, { timezone: tenant.timezone,
            scope: await this.scope(tenant, storeId),
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            search,
            segment,
            customerType,
            sortBy,
            sortDir,
            createdFrom,
            createdTo,
        });
    }

    @RequireAnyStorePermission(...CUSTOMER_CREDIT_READ)
    @Get('credit/payments')
    async listCreditPayments(
        @Tenant() tenant: TenantContext,
        @Query() query: ListCustomerCreditPaymentsQueryDto,
    ) {
        const { storeId, ...rest } = query;
        return this.customersService.listCreditPayments(tenant.tenantId, {
            ...rest,
            timezone: tenant.timezone,
            // The page's branch filter, under the same rule as every branch-aware list.
            branch: await this.branchScope.resolveStoreId(tenant, storeId, { permissions: CUSTOMER_CREDIT_READ }),
            scope: await this.scope(tenant),
        });
    }

    /** The serial a new payment would get. Declared before `:paymentId` so it is not captured as one. */
    @RequireAnyStorePermission(...CUSTOMER_CREDIT_WRITE)
    @Get('credit/payments/next-number')
    async getNextPaymentNumber(
        @Tenant() tenant: TenantContext,
        @Query() query: NextCustomerPaymentNumberQueryDto,
    ) {
        return this.customersService.getNextPaymentNumber(tenant.tenantId, query.direction);
    }

    @RequireAnyStorePermission(...CUSTOMER_CREDIT_READ)
    @Get('credit/payments/:paymentId')
    async getCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.customersService.getCreditPayment(tenant.tenantId, paymentId, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...CUSTOMER_CREDIT_WRITE)
    @Patch('credit/payments/:paymentId')
    async updateCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
        @Body() dto: UpdateCreditPaymentDto,
    ) {
        return this.customersService.updateCreditPayment(
            tenant.tenantId,
            paymentId,
            dto,
            tenant.storeId,
            await this.scope(tenant),
            tenant.timezone,
        );
    }

    @RequireAnyStorePermission(...CUSTOMER_CREDIT_WRITE)
    @Delete('credit/payments/:paymentId')
    async deleteCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.customersService.deleteCreditPayment(tenant.tenantId, paymentId, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...CUSTOMER_WRITE)
    @Post('segments/evaluate')
    async evaluateSegments(@Tenant() tenant: TenantContext) {
        return this.segmentsService.evaluateForTenant(tenant.tenantId);
    }

    @RequireAnyStorePermission(...CUSTOMER_WRITE)
    @Post('import')
    async importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        // The file's branch: the one picked in the import dialog — checked like
        // any requested branch — else the header branch.
        const fileBranch = body.storeId
            ? await this.branchScope.resolveStoreId(tenant, body.storeId, { permissions: CUSTOMER_WRITE, allowAll: false })
            : tenant.storeId;
        return this.customersService.importRows(
            tenant.tenantId,
            body.rows,
            body.mode,
            fileBranch,
            await this.scope(tenant),
        );
    }

    /**
     * Employees a customer's sales rep can be picked from: id and name only.
     * Here rather than on /employees, which needs HR permission (it carries
     * pay); choosing a rep is a sales task. Declared before `:id`.
     */
    @RequireAnyStorePermission(...CUSTOMER_READ)
    @Get('sales-reps')
    async salesReps(@Tenant() tenant: TenantContext) {
        return this.customersService.salesReps(tenant.tenantId);
    }

    @RequireAnyStorePermission(...CUSTOMER_READ)
    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.customersService.findOne(tenant.tenantId, id, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...CUSTOMER_READ)
    @Get(':id/history')
    async getHistory(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.customersService.getPurchaseHistory(tenant.tenantId, id, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            from,
            to,
        }, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...CUSTOMER_READ)
    @Get(':id/analytics')
    async getAnalytics(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.customersService.getAnalytics(tenant.tenantId, id, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...CUSTOMER_CREDIT_READ)
    @Get(':id/credit')
    async getCreditLedger(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.customersService.getCreditLedger(tenant.tenantId, id, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            from,
            to,
        }, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...CUSTOMER_CREDIT_READ)
    @Get(':id/gl-ledger')
    async getGlLedger(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.customersService.getGlLedger(tenant.tenantId, id, { from, to }, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...CUSTOMER_CREDIT_WRITE)
    @Post(':id/credit/payment')
    async recordCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: RecordCreditPaymentDto,
    ) {
        return this.customersService.recordCreditPayment(
            tenant.tenantId,
            id,
            tenant.userId,
            dto,
            tenant.storeId,
            await this.scope(tenant),
            tenant.timezone,
        );
    }

    /**
     * Every debt this workspace has forgiven. Listed before the `:id` routes
     * because 'credit' would otherwise be captured as a customer id.
     */
    @Get('credit/write-offs')
    @RequireStorePermission(StorePermission.WRITE_OFF_CUSTOMER_DEBT)
    async listWriteOffs(
        @Tenant() tenant: TenantContext,
        @Query() query: ListCustomerWriteOffsQueryDto,
    ) {
        return this.customersService.listWriteOffs(tenant.tenantId, {
            ...query,
            timezone: tenant.timezone,
            scope: await this.scope(tenant),
        });
    }

    @Post('credit/write-offs/:writeOffId/reverse')
    @RequireStorePermission(StorePermission.WRITE_OFF_CUSTOMER_DEBT)
    async reverseWriteOff(
        @Tenant() tenant: TenantContext,
        @Param('writeOffId') writeOffId: string,
    ) {
        return this.customersService.reverseWriteOff(tenant.tenantId, writeOffId, await this.scope(tenant));
    }

    @Post(':id/credit/write-off')
    @RequireStorePermission(StorePermission.WRITE_OFF_CUSTOMER_DEBT)
    async writeOffDebt(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: WriteOffCustomerDebtDto,
    ) {
        return this.customersService.writeOffDebt(
            tenant.tenantId,
            id,
            tenant.userId,
            dto,
            tenant.storeId,
            await this.scope(tenant),
        );
    }

    @RequireAnyStorePermission(...CUSTOMER_CREDIT_READ)
    @Get('reports/due-aging')
    async getDueAgingReport(@Tenant() tenant: TenantContext) {
        return this.customersService.getDueAgingReport(tenant.tenantId, await this.scope(tenant));
    }

    @RequireAnyStorePermission(...CUSTOMER_WRITE)
    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
        return this.customersService.update(tenant.tenantId, id, dto, {
            scope: await this.scope(tenant),
            canSetBranch: await this.customerScope.canSeeAll(tenant),
        });
    }
}
