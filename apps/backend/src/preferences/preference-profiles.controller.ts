import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    ApplyPreferenceProfileDto,
    CreatePreferenceProfileDto,
    UpdatePreferenceProfileDto,
} from './preference-profiles.dto';
import { PreferenceProfilesService } from './preference-profiles.service';

/** The workspace's starting-preference profiles. Managing them needs MANAGE_USERS. */
@Controller('preference-profiles')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PreferenceProfilesController {
    constructor(private readonly profiles: PreferenceProfilesService) {}

    @RequireStorePermission(StorePermission.MANAGE_USERS)
    @Get()
    list(@Tenant() tenant: TenantContext) {
        return this.profiles.list(tenant.tenantId);
    }

    @RequireStorePermission(StorePermission.MANAGE_USERS)
    @Get(':id')
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.profiles.get(tenant.tenantId, id);
    }

    @RequireStorePermission(StorePermission.MANAGE_USERS)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePreferenceProfileDto) {
        return this.profiles.create(tenant, dto);
    }

    @RequireStorePermission(StorePermission.MANAGE_USERS)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdatePreferenceProfileDto) {
        return this.profiles.update(tenant, id, dto);
    }

    @RequireStorePermission(StorePermission.MANAGE_USERS)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.profiles.remove(tenant, id);
    }

    @RequireStorePermission(StorePermission.MANAGE_USERS)
    @Post(':id/apply')
    apply(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: ApplyPreferenceProfileDto) {
        return this.profiles.apply(tenant, id, dto);
    }
}
