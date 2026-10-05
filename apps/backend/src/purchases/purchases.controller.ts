import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { CancelEntryDto } from '../common/cancel-entry.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission, RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SortableBranchListQueryDto } from '../common/branch-list-query.dto';
import { BranchScopeService } from '../database/branch-scope.service';
import { CreatePurchaseDto } from './purchase.dto';
import { PurchasesService } from './purchases.service';

import { PURCHASE_READ, PURCHASE_WRITE } from '../auth/permission-sets';
// `StorePermissionGuard` is class-wide but only the cancel route names a
// permission; the guard is a no-op for a handler that requires none, so every
// other route keeps the access it had.
@Controller('purchases')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PurchasesController {
    constructor(
        private readonly purchasesService: PurchasesService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseDto) {
        return this.purchasesService.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: SortableBranchListQueryDto,
    ) {
        const { sortBy, sortDir } = query;
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return this.purchasesService.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            storeId,
            sortBy,
            sortDir,
        });
    }

    /**
     * Cancel a posted purchase and reverse its impacts. Tenant-admin only: only
     * OWNER and the Tenant Admin role hold `CANCEL_ENTRY`.
     */
    @Post(':id/cancel')
    @RequireStorePermission(StorePermission.CANCEL_ENTRY)
    cancel(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CancelEntryDto,
    ) {
        return this.purchasesService.cancel(tenant.tenantId, tenant.userId, id, dto.note);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id/invoice')
    getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchasesService.getInvoiceData(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchasesService.findOne(tenant.tenantId, id);
    }
}