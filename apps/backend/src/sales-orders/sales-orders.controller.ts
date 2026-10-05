import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto, UpdateSalesOrderDto, UpdateOrderStatusDto, AddDepositDto } from './sales-orders.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchListQueryDto } from '../common/branch-list-query.dto';
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

    @RequireAnyStorePermission(...SALES_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: BranchListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        return this.ordersService.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            storeId,
        });
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
