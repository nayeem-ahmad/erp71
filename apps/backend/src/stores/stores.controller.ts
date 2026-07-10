import { Body, Controller, Param, Patch, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { StoresService } from './stores.service';
import { UpdateStoreDto } from './update-store.dto';

@Controller('stores')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class StoresController {
    constructor(private readonly stores: StoresService) {}

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
