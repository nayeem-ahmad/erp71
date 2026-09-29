import { Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { AddonModulesService } from './addon-modules.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { BILLING_ADMIN } from '../auth/permission-sets';
@Controller('addon-modules')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class AddonModulesController {
    constructor(private readonly addonModules: AddonModulesService) {}

    @Get()
    listCatalog() {
        return this.addonModules.listCatalogForTenants();
    }

    @Get('mine')
    listMine(@Tenant() tenant: TenantContext) {
        return this.addonModules.getActiveForTenant(tenant.tenantId);
    }

    @RequireAnyStorePermission(...BILLING_ADMIN)
    @Post(':code/cancel-at-period-end')
    cancel(@Tenant() tenant: TenantContext, @Param('code') code: string) {
        return this.addonModules.cancelAddonAtPeriodEnd(tenant.tenantId, code);
    }
}
