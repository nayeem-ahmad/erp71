import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchListQueryDto } from '../common/branch-list-query.dto';
import { BranchScopeService } from '../database/branch-scope.service';
import { CreateStockTakeSessionDto, UpdateStockTakeCountsDto, UpdateStockTakeStatusDto } from './stock-takes.dto';
import { StockTakesService } from './stock-takes.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { STOCK_TAKE_STAFF } from '../auth/permission-sets';
@Controller('stock-takes')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class StockTakesController {
    constructor(
        private readonly service: StockTakesService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...STOCK_TAKE_STAFF)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateStockTakeSessionDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...STOCK_TAKE_STAFF)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: BranchListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: STOCK_TAKE_STAFF });
        return this.service.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            storeId,
        });
    }

    @RequireAnyStorePermission(...STOCK_TAKE_STAFF)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...STOCK_TAKE_STAFF)
    @Patch(':id/counts')
    updateCounts(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateStockTakeCountsDto) {
        return this.service.updateCounts(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...STOCK_TAKE_STAFF)
    @Patch(':id/status')
    updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateStockTakeStatusDto) {
        return this.service.updateStatus(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...STOCK_TAKE_STAFF)
    @Post(':id/post')
    post(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.post(tenant.tenantId, id);
    }
}