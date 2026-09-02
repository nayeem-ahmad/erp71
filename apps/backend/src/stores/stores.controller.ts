import { Body, Controller, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { StoresService } from './stores.service';
import { CreateStoreDto } from './create-store.dto';
import { UpdateStoreDto } from './update-store.dto';

@Controller('stores')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
export class StoresController {
    constructor(private readonly stores: StoresService) {}

    /**
     * Deliberately method-level: adding a branch is what the `multiStore`
     * entitlement sells, but a single-branch tenant must still be able to rename
     * the one branch it has, so the gate cannot sit on the controller.
     */
    @Post()
    @RequireStorePermission(StorePermission.MANAGE_STORES)
    @RequiresFeature('multiStore')
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateStoreDto) {
        return this.stores.create(tenant, dto);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_STORES)
    async rename(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateStoreDto,
    ) {
        return this.stores.rename(tenant.tenantId, id, dto.name);
    }
}
