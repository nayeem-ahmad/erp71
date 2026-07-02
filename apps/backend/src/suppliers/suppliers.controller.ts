import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    CreateSupplierDto,
    ListSupplierCreditPaymentsQueryDto,
    RecordSupplierCreditPaymentDto,
    SupplierCreditLedgerQueryDto,
    UpdateSupplierCreditPaymentDto,
    UpdateSupplierDto,
} from './supplier.dto';
import { SuppliersService } from './suppliers.service';
import { ImportRowsDto } from '../common/import.dto';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SuppliersController {
    constructor(private readonly suppliersService: SuppliersService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateSupplierDto) {
        return this.suppliersService.create(tenant.tenantId, dto);
    }

    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.suppliersService.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.suppliersService.findAll(tenant.tenantId, query.page, query.limit);
    }

    @Get('credit/payments')
    listCreditPayments(
        @Tenant() tenant: TenantContext,
        @Query() query: ListSupplierCreditPaymentsQueryDto,
    ) {
        return this.suppliersService.listCreditPayments(tenant.tenantId, query);
    }

    @Get('credit/payments/:paymentId')
    getCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.suppliersService.getCreditPayment(tenant.tenantId, paymentId);
    }

    @Patch('credit/payments/:paymentId')
    updateCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
        @Body() dto: UpdateSupplierCreditPaymentDto,
    ) {
        return this.suppliersService.updateCreditPayment(tenant.tenantId, paymentId, dto);
    }

    @Delete('credit/payments/:paymentId')
    deleteCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('paymentId') paymentId: string,
    ) {
        return this.suppliersService.deleteCreditPayment(tenant.tenantId, paymentId);
    }

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

    @Post(':id/credit/payment')
    recordCreditPayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: RecordSupplierCreditPaymentDto,
    ) {
        return this.suppliersService.recordCreditPayment(tenant.tenantId, id, tenant.userId, dto);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.suppliersService.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
        return this.suppliersService.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.suppliersService.remove(tenant.tenantId, id);
    }
}