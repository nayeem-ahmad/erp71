import { BadRequestException, Controller, Post, Get, Body, Param, Query, UseGuards, UseInterceptors, Patch, Delete, ForbiddenException } from '@nestjs/common';
import { readColumnFiltersQuery } from '../common/column-filter.util';
import { readIdListQuery, readNumberConditionQuery } from '../common/number-condition.util';
import { StorePermission } from '@erp71/shared-types';
import { SALE_PAYMENT_STATUSES, SalesService, type SaleListFilters, type SalePaymentStatus } from './sales.service';
import { CreateSaleDto, CreateSalesFromQuotationsDto, FinalizeSaleDto, PrintSalesBatchDto, UpdateSaleDto } from './sale.dto';
import { CancelEntryDto } from '../common/cancel-entry.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission, RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';

import { SALES_READ, SALE_DELETE, SALE_WRITE } from '../auth/permission-sets';
import { TrackHistory } from '../record-history/track-history.decorator';
import type { QuotationConversionResult } from './quotation-to-sale.util';
// `StorePermissionGuard` is class-wide but only the cancel route names a
// permission; the guard is a no-op for a handler that requires none, so every
// other route keeps the access it had.
@Controller('sales')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SalesController {
    constructor(
        private readonly salesService: SalesService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...SALE_WRITE)
    @TrackHistory('SALE', { action: 'CREATE' })
    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSaleDto) {
        return this.salesService.create(tenant.tenantId, tenant.userId, dto);
    }

    /**
     * The list's filters, read once for the list and its stats strip. New
     * params go after `filters`: a spec calls `findAll` positionally up to
     * `storeId`.
     */
    private async listFilters(
        tenant: TenantContext,
        q: {
            mine?: string;
            search?: string;
            status?: string;
            createdFrom?: string;
            createdTo?: string;
            storeId?: string;
            dateFrom?: string;
            dateTo?: string;
            filters?: string;
            statusExclude?: string;
            customerId?: string;
            salesRepId?: string;
            paymentMethodId?: string;
            paymentStatus?: string;
            total?: string;
            paid?: string;
        },
    ): Promise<SaleListFilters> {
        const mineOnly = q.mine === 'true' || q.mine === '1';
        const storeId = await this.branchScope.resolveStoreId(tenant, q.storeId, { permissions: SALES_READ });
        const paymentStatus = readIdListQuery(q.paymentStatus);
        if (paymentStatus?.some((value) => !SALE_PAYMENT_STATUSES.includes(value as SalePaymentStatus))) {
            throw new BadRequestException(`paymentStatus takes ${SALE_PAYMENT_STATUSES.join(', ')}`);
        }
        return {
            timezone: tenant.timezone,
            storeId,
            createdBy: mineOnly ? tenant.userId : undefined,
            search: q.search || undefined,
            status: q.status || undefined,
            statusExclude: q.statusExclude === 'true' || q.statusExclude === '1',
            createdFrom: q.createdFrom || undefined,
            createdTo: q.createdTo || undefined,
            dateFrom: q.dateFrom || undefined,
            dateTo: q.dateTo || undefined,
            filters: readColumnFiltersQuery(q.filters),
            customerIds: readIdListQuery(q.customerId),
            salesRepIds: readIdListQuery(q.salesRepId),
            paymentMethodIds: readIdListQuery(q.paymentMethodId),
            paymentStatus: paymentStatus as SalePaymentStatus[] | undefined,
            total: readNumberConditionQuery(q.total, 'total'),
            paid: readNumberConditionQuery(q.paid, 'paid'),
        };
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('mine') mine?: string,
        @Query('search') search?: string,
        @Query('status') status?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
        @Query('storeId') requestedStoreId?: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
        @Query('filters') filters?: string,
        @Query('statusExclude') statusExclude?: string,
        @Query('customerId') customerId?: string,
        @Query('salesRepId') salesRepId?: string,
        @Query('paymentMethodId') paymentMethodId?: string,
        @Query('paymentStatus') paymentStatus?: string,
        @Query('total') total?: string,
        @Query('paid') paid?: string,
    ) {
        const listFilters = await this.listFilters(tenant, {
            mine, search, status, createdFrom, createdTo, storeId: requestedStoreId, dateFrom, dateTo, filters,
            statusExclude, customerId, salesRepId, paymentMethodId, paymentStatus, total, paid,
        });
        return this.salesService.findAll(tenant.tenantId, {
            ...listFilters,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            sortBy: sortBy || undefined,
            sortDir: sortDir || undefined,
        });
    }

    /**
     * The stats strip above the sales list: counts and amounts over the same
     * filters as `GET /sales`. Declared before `:id`, which would take
     * "summary" for an id.
     */
    @RequireAnyStorePermission(...SALES_READ)
    @Get('summary')
    async summary(
        @Tenant() tenant: TenantContext,
        @Query('mine') mine?: string,
        @Query('search') search?: string,
        @Query('status') status?: string,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
        @Query('storeId') requestedStoreId?: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
        @Query('filters') filters?: string,
        @Query('statusExclude') statusExclude?: string,
        @Query('customerId') customerId?: string,
        @Query('salesRepId') salesRepId?: string,
        @Query('paymentMethodId') paymentMethodId?: string,
        @Query('paymentStatus') paymentStatus?: string,
        @Query('total') total?: string,
        @Query('paid') paid?: string,
    ) {
        const listFilters = await this.listFilters(tenant, {
            mine, search, status, createdFrom, createdTo, storeId: requestedStoreId, dateFrom, dateTo, filters,
            statusExclude, customerId, salesRepId, paymentMethodId, paymentStatus, total, paid,
        });
        return this.salesService.summary(tenant.tenantId, listFilters);
    }

    /**
     * Invoices the quotations selected on the quotations list, each as a credit
     * sale in its own branch. A branch the caller cannot sell in is skipped for
     * that quotation rather than refusing the whole batch.
     */
    @RequireAnyStorePermission(...SALE_WRITE)
    @TrackHistory('SALE', {
        action: 'CREATE',
        resultIds: (result: QuotationConversionResult) => result.converted.map((sale) => sale.saleId),
    })
    @Post('from-quotations')
    async createFromQuotations(@Tenant() tenant: TenantContext, @Body() dto: CreateSalesFromQuotationsDto) {
        return this.salesService.createFromQuotations(tenant.tenantId, tenant.userId, dto, (storeId) =>
            this.branchScope
                .resolveStoreId(tenant, storeId, { permissions: SALE_WRITE, allowAll: false })
                .then(
                    () => true,
                    (error) => {
                        if (error instanceof ForbiddenException) return false;
                        throw error;
                    },
                ),
        );
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Post('print-batch')
    async printBatch(@Tenant() tenant: TenantContext, @Body() dto: PrintSalesBatchDto) {
        return this.salesService.findForPrintBatch(tenant.tenantId, dto.ids);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id/invoice')
    async getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.getInvoiceData(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SALE_WRITE)
    @TrackHistory('SALE', { action: 'FINALIZE' })
    @Post(':id/finalize')
    async finalize(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: FinalizeSaleDto,
    ) {
        return this.salesService.finalizeDraft(tenant.tenantId, tenant.userId, id, dto);
    }

    @RequireAnyStorePermission(...SALE_WRITE)
    @TrackHistory('SALE', { action: 'UPDATE' })
    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSaleDto) {
        return this.salesService.update(tenant.tenantId, tenant.userId, id, dto);
    }

    /**
     * Cancel a posted sale and reverse its impacts. Tenant-admin only: only
     * OWNER and the Tenant Admin role hold `CANCEL_ENTRY`.
     */
    @TrackHistory('SALE', { action: 'CANCEL' })
    @Post(':id/cancel')
    @RequireStorePermission(StorePermission.CANCEL_ENTRY)
    async cancel(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CancelEntryDto,
    ) {
        return this.salesService.cancel(tenant.tenantId, tenant.userId, id, dto.note);
    }

    @RequireAnyStorePermission(...SALE_DELETE)
    @TrackHistory('SALE', { action: 'DELETE' })
    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.remove(tenant.tenantId, id);
    }
}
