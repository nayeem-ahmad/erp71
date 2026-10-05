import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchListQueryDto } from '../common/branch-list-query.dto';
import { BranchScopeService } from '../database/branch-scope.service';
import { CreatePurchaseReturnDto, UpdatePurchaseReturnDto } from './purchase-return.dto';
import { PurchaseReturnsService } from './purchase-returns.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PURCHASE_READ, PURCHASE_RETURN_WRITE } from '../auth/permission-sets';
@Controller('purchase-returns')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PurchaseReturnsController {
    constructor(
        private readonly purchaseReturnsService: PurchaseReturnsService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...PURCHASE_RETURN_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseReturnDto) {
        return this.purchaseReturnsService.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: BranchListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return this.purchaseReturnsService.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            storeId,
        });
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchaseReturnsService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PURCHASE_RETURN_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdatePurchaseReturnDto) {
        return this.purchaseReturnsService.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...PURCHASE_RETURN_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchaseReturnsService.remove(tenant.tenantId, id);
    }
}