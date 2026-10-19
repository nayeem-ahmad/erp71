import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { SalesReturnsService } from './sales-returns.service';
import { CreateSalesReturnDto, UpdateSalesReturnDto } from './sales-returns.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchListQueryDto } from '../common/branch-list-query.dto';
import { BranchScopeService } from '../database/branch-scope.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SALES_READ, SALES_RETURN_WRITE } from '../auth/permission-sets';
import { TrackHistory } from '../record-history/track-history.decorator';
@Controller('sales-returns')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SalesReturnsController {
    constructor(
        private readonly returnsService: SalesReturnsService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...SALES_RETURN_WRITE)
    @TrackHistory('SALES_RETURN', { action: 'CREATE' })
    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSalesReturnDto) {
        return this.returnsService.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: BranchListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        return this.returnsService.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            storeId,
        });
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.returnsService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SALES_RETURN_WRITE)
    @TrackHistory('SALES_RETURN', { action: 'UPDATE' })
    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSalesReturnDto) {
        return this.returnsService.update(tenant.tenantId, id, dto, tenant.userId);
    }

    @RequireAnyStorePermission(...SALES_RETURN_WRITE)
    @TrackHistory('SALES_RETURN', { action: 'DELETE' })
    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.returnsService.remove(tenant.tenantId, id, tenant.userId);
    }
}
