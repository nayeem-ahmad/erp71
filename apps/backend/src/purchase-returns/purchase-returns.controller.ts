import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DocumentListQueryDto, readDocumentListFilters } from '../common/document-list-filters';
import { BranchScopeService } from '../database/branch-scope.service';
import { CreatePurchaseReturnDto, UpdatePurchaseReturnDto } from './purchase-return.dto';
import { PurchaseReturnsService } from './purchase-returns.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PURCHASE_READ, PURCHASE_RETURN_WRITE } from '../auth/permission-sets';
import { TrackHistory } from '../record-history/track-history.decorator';
@Controller('purchase-returns')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PurchaseReturnsController {
    constructor(
        private readonly purchaseReturnsService: PurchaseReturnsService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...PURCHASE_RETURN_WRITE)
    @TrackHistory('PURCHASE_RETURN', { action: 'CREATE' })
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseReturnDto) {
        return this.purchaseReturnsService.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: DocumentListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return this.purchaseReturnsService.findAll(tenant.tenantId, query.page, query.limit, {
            ...readDocumentListFilters(query, { storeId, timezone: tenant.timezone }),
            sortBy: query.sortBy,
            sortDir: query.sortDir,
        });
    }

    /**
     * The stats strip above the purchase-returns list, over the same filters
     * as `GET /purchase-returns`. Declared before `:id`.
     */
    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('summary')
    async summary(
        @Tenant() tenant: TenantContext,
        @Query() query: DocumentListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return this.purchaseReturnsService.summary(
            tenant.tenantId,
            readDocumentListFilters(query, { storeId, timezone: tenant.timezone }),
        );
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchaseReturnsService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PURCHASE_RETURN_WRITE)
    @TrackHistory('PURCHASE_RETURN', { action: 'UPDATE' })
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdatePurchaseReturnDto) {
        return this.purchaseReturnsService.update(tenant.tenantId, id, dto, tenant.userId);
    }

    @RequireAnyStorePermission(...PURCHASE_RETURN_WRITE)
    @TrackHistory('PURCHASE_RETURN', { action: 'DELETE' })
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchaseReturnsService.remove(tenant.tenantId, id, tenant.userId);
    }
}