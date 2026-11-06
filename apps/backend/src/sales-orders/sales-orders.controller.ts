import { BadRequestException, Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { SalesOrdersService, type SalesOrderListFilters } from './sales-orders.service';
import {
    CreateSalesOrderDto,
    UpdateSalesOrderDto,
    UpdateOrderStatusDto,
    AddDepositDto,
    SALES_ORDER_PAYMENT_STATUSES,
    SalesOrderListQueryDto,
    type SalesOrderPaymentStatus,
} from './sales-orders.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { readSalesDocumentListFilters } from '../common/sales-document-list-filters';
import { readIdListQuery } from '../common/number-condition.util';
import { BranchScopeService } from '../database/branch-scope.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SALES_ORDER_WRITE, SALES_READ } from '../auth/permission-sets';
@Controller('sales-orders')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SalesOrdersController {
    constructor(
        private readonly ordersService: SalesOrdersService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...SALES_ORDER_WRITE)
    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSalesOrderDto) {
        return this.ordersService.create(tenant.tenantId, tenant.userId, dto);
    }

    /** The list's filters, read once for the rows and the stats strip alike. */
    private async listFilters(tenant: TenantContext, query: SalesOrderListQueryDto): Promise<SalesOrderListFilters> {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        const paymentStatus = readIdListQuery(query.paymentStatus)?.map((value) => value.toUpperCase());
        if (paymentStatus?.some((value) => !SALES_ORDER_PAYMENT_STATUSES.includes(value as SalesOrderPaymentStatus))) {
            throw new BadRequestException(`paymentStatus takes ${SALES_ORDER_PAYMENT_STATUSES.join(', ')}`);
        }
        return {
            ...readSalesDocumentListFilters(query, { storeId, timezone: tenant.timezone }),
            paymentStatus: paymentStatus as SalesOrderPaymentStatus[] | undefined,
        };
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: SalesOrderListQueryDto,
    ) {
        return this.ordersService.findAll(tenant.tenantId, query.page, query.limit, {
            ...(await this.listFilters(tenant, query)),
            sortBy: query.sortBy,
            sortDir: query.sortDir,
        });
    }

    /**
     * The stats strip above the list, over the same filters as
     * `GET /sales-orders`. Declared before `:id`, which would take "summary"
     * for an id.
     */
    @RequireAnyStorePermission(...SALES_READ)
    @Get('summary')
    async summary(
        @Tenant() tenant: TenantContext,
        @Query() query: SalesOrderListQueryDto,
    ) {
        return this.ordersService.summary(tenant.tenantId, await this.listFilters(tenant, query));
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.ordersService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SALES_ORDER_WRITE)
    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
        return this.ordersService.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...SALES_ORDER_WRITE)
    @Patch(':id/status')
    async updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
        return this.ordersService.updateStatus(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...SALES_ORDER_WRITE)
    @Post(':id/deposits')
    async addDeposit(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: AddDepositDto) {
        return this.ordersService.addDeposit(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...SALES_ORDER_WRITE)
    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.ordersService.remove(tenant.tenantId, id);
    }
}
