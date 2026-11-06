import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DocumentListQueryDto, readDocumentListFilters } from '../common/document-list-filters';
import { BranchScopeService } from '../database/branch-scope.service';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PURCHASE_READ, PURCHASE_WRITE } from '../auth/permission-sets';
@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PurchaseOrdersController {
    constructor(
        private readonly service: PurchaseOrdersService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseOrderDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: DocumentListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return this.service.findAll(tenant.tenantId, query.page, query.limit, {
            ...readDocumentListFilters(query, { storeId, timezone: tenant.timezone }),
            sortBy: query.sortBy,
            sortDir: query.sortDir,
        });
    }

    /**
     * The stats strip above the list, over the same filters as
     * `GET /purchase-orders`. Declared before `:id`, which would take "summary" for an id.
     */
    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('summary')
    async summary(
        @Tenant() tenant: TenantContext,
        @Query() query: DocumentListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return this.service.summary(tenant.tenantId, readDocumentListFilters(query, { storeId, timezone: tenant.timezone }));
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @Patch(':id/status')
    updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderStatusDto) {
        return this.service.updateStatus(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id/invoice')
    getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getInvoiceData(tenant.tenantId, id);
    }
}
