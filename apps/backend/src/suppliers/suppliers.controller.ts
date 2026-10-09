import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
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
} from './supplier.dto';
import { SuppliersService } from './suppliers.service';
import { ImportRowsDto } from '../common/import.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SUPPLIER_CREDIT_READ, SUPPLIER_CREDIT_WRITE, SUPPLIER_READ, SUPPLIER_WRITE } from '../auth/permission-sets';
@Controller('suppliers')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SuppliersController {
    constructor(private readonly suppliersService: SuppliersService) {}

    @RequireAnyStorePermission(...SUPPLIER_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateSupplierDto) {
        return this.suppliersService.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...SUPPLIER_WRITE)
    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.suppliersService.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @RequireAnyStorePermission(...SUPPLIER_READ)
    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PaginationDto,
        @Query('search') search?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
    ) {
        return this.suppliersService.findAll(tenant.tenantId, query.page, query.limit, { search, sortBy, sortDir });
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get('credit/payments')
    listCreditPayments(
        @Tenant() tenant: TenantContext,
        @Query() query: ListSupplierCreditPaymentsQueryDto,
    ) {
        return this.suppliersService.listCreditPayments(tenant.tenantId, { ...query, timezone: tenant.timezone });
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
    getCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.suppliersService.getCreditPayment(tenant.tenantId, paymentId);
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Patch('credit/payments/:paymentId')
    updateCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
        @Body() dto: UpdateSupplierCreditPaymentDto,
    ) {
        return this.suppliersService.updateCreditPayment(tenant.tenantId, paymentId, dto, tenant.timezone);
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Delete('credit/payments/:paymentId')
    deleteCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.suppliersService.deleteCreditPayment(tenant.tenantId, paymentId);
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Post('credit/payments/:paymentId/allocate')
    allocatePayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
        @Body() dto: AllocateSupplierPaymentDto,
    ) {
        return this.suppliersService.allocatePayment(tenant.tenantId, paymentId, dto);
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Delete('credit/allocations/:allocationId')
    removeAllocation(
        @Tenant() tenant: TenantContext,
        @Param('allocationId') allocationId: string,
    ) {
        return this.suppliersService.removeAllocation(tenant.tenantId, allocationId);
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get(':id/billing-summary')
    getBillingSummary(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
    ) {
        return this.suppliersService.getBillingSummary(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get(':id/credit')
    getCreditLedger(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query() query: SupplierCreditLedgerQueryDto,
    ) {
        return this.suppliersService.getCreditLedger(tenant.tenantId, id, {
            page: query.page,
            limit: query.limit,
            from: query.from,
            to: query.to,
        });
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_READ)
    @Get(':id/gl-ledger')
    getGlLedger(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query() query: SupplierCreditLedgerQueryDto,
    ) {
        return this.suppliersService.getGlLedger(tenant.tenantId, id, { from: query.from, to: query.to });
    }

    @RequireAnyStorePermission(...SUPPLIER_CREDIT_WRITE)
    @Post(':id/credit/payment')
    recordCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: RecordSupplierCreditPaymentDto,
    ) {
        return this.suppliersService.recordCreditPayment(tenant.tenantId, id, tenant.userId, dto, tenant.timezone);
    }

    @RequireAnyStorePermission(...SUPPLIER_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.suppliersService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SUPPLIER_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
        return this.suppliersService.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...SUPPLIER_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.suppliersService.remove(tenant.tenantId, id);
    }
}