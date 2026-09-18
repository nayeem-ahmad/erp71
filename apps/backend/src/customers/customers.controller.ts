import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { SegmentsService } from './segments.service';
import {
    CreateCustomerDto,
    UpdateCustomerDto,
    RecordCreditPaymentDto,
    UpdateCreditPaymentDto,
    ListCustomerCreditPaymentsQueryDto,
    WriteOffCustomerDebtDto,
    ListCustomerWriteOffsQueryDto,
} from './customer.dto';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ImportRowsDto } from '../common/import.dto';

// `StorePermissionGuard` is class-wide but only the write-off routes name a
// permission, so every other route behaves exactly as before — the guard is a
// no-op without `@RequireStorePermission`. Same arrangement as
// sales.controller.ts and its cancel route.
@Controller('customers')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CustomersController {
    constructor(
        private readonly customersService: CustomersService,
        private readonly segmentsService: SegmentsService,
    ) {}

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateCustomerDto) {
        return this.customersService.create(tenant.tenantId, dto);
    }

    @Get('segment-stats')
    async getSegmentStats(@Tenant() tenant: TenantContext) {
        return this.customersService.getSegmentStats(tenant.tenantId);
    }

    @Post('run-segmentation')
    async runSegmentation(@Tenant() tenant: TenantContext) {
        return this.segmentsService.runForTenant(tenant.tenantId);
    }

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
    ) {
        return this.customersService.findAll(tenant.tenantId, { timezone: tenant.timezone,
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

    @Get('credit/payments')
    async listCreditPayments(
        @Tenant() tenant: TenantContext,
        @Query() query: ListCustomerCreditPaymentsQueryDto,
    ) {
        return this.customersService.listCreditPayments(tenant.tenantId, { ...query, timezone: tenant.timezone });
    }

    @Get('credit/payments/:paymentId')
    async getCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.customersService.getCreditPayment(tenant.tenantId, paymentId);
    }

    @Patch('credit/payments/:paymentId')
    async updateCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
        @Body() dto: UpdateCreditPaymentDto,
    ) {
        return this.customersService.updateCreditPayment(tenant.tenantId, paymentId, dto, tenant.storeId);
    }

    @Delete('credit/payments/:paymentId')
    async deleteCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.customersService.deleteCreditPayment(tenant.tenantId, paymentId);
    }

    @Post('segments/evaluate')
    async evaluateSegments(@Tenant() tenant: TenantContext) {
        return this.segmentsService.evaluateForTenant(tenant.tenantId);
    }

    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.customersService.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.customersService.findOne(tenant.tenantId, id);
    }

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
        });
    }

    @Get(':id/analytics')
    async getAnalytics(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.customersService.getAnalytics(tenant.tenantId, id);
    }

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
        });
    }

    @Get(':id/gl-ledger')
    async getGlLedger(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.customersService.getGlLedger(tenant.tenantId, id, { from, to });
    }

    @Post(':id/credit/payment')
    async recordCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: RecordCreditPaymentDto,
    ) {
        return this.customersService.recordCreditPayment(tenant.tenantId, id, tenant.userId, dto, tenant.storeId);
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
        });
    }

    @Post('credit/write-offs/:writeOffId/reverse')
    @RequireStorePermission(StorePermission.WRITE_OFF_CUSTOMER_DEBT)
    async reverseWriteOff(
        @Tenant() tenant: TenantContext,
        @Param('writeOffId') writeOffId: string,
    ) {
        return this.customersService.reverseWriteOff(tenant.tenantId, writeOffId);
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
        );
    }

    @Get('reports/due-aging')
    async getDueAgingReport(@Tenant() tenant: TenantContext) {
        return this.customersService.getDueAgingReport(tenant.tenantId);
    }

    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
        return this.customersService.update(tenant.tenantId, id, dto);
    }
}
