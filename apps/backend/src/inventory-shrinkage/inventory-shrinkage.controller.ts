import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { CreateInventoryShrinkageDto, ShrinkageDirection, UpdateInventoryShrinkageDto } from './inventory-shrinkage.dto';
import { InventoryShrinkageService } from './inventory-shrinkage.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SHRINKAGE_CORRECT, SHRINKAGE_STAFF } from '../auth/permission-sets';

@Controller('inventory-shrinkage')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class InventoryShrinkageController {
    constructor(
        private readonly service: InventoryShrinkageService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...SHRINKAGE_STAFF)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateInventoryShrinkageDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    /**
     * `direction` narrows the log to write-offs (LOSS) or surpluses (FOUND).
     * Omitted returns both — this is the entry log, where seeing the two
     * together is the point; the reports scope themselves instead.
     */
    @RequireAnyStorePermission(...SHRINKAGE_STAFF)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
        @Query('direction') direction?: string,
        @Query('storeId') requestedStoreId?: string,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, requestedStoreId, { permissions: SHRINKAGE_STAFF });
        return this.service.findAll(tenant.tenantId, {
            timezone: tenant.timezone,
            storeId,
            createdFrom,
            createdTo,
            direction: direction === 'LOSS' || direction === 'FOUND' ? (direction as ShrinkageDirection) : undefined,
        });
    }

    @RequireAnyStorePermission(...SHRINKAGE_STAFF)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    /**
     * Corrects reason, note and lines. Direction and warehouse are fixed by the
     * stored entry — see `UpdateInventoryShrinkageDto`.
     */
    @RequireAnyStorePermission(...SHRINKAGE_CORRECT)
    @Patch(':id')
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateInventoryShrinkageDto,
    ) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    /** Puts the stock and the voucher back, then removes the entry. */
    @RequireAnyStorePermission(...SHRINKAGE_CORRECT)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}