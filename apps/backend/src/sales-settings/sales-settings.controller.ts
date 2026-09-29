import { Controller, Get, Patch, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SalesSettingsService } from './sales-settings.service';
import { UpdateSalesSettingsDto, SalesSettingsResponseDto } from './sales-settings.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SETTINGS_ADMIN } from '../auth/permission-sets';
@Controller('sales-settings')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SalesSettingsController {
  constructor(private readonly salesSettingsService: SalesSettingsService) {}

  @Get()
  async get(@Tenant() tenant: TenantContext): Promise<SalesSettingsResponseDto> {
    return this.salesSettingsService.get(tenant.tenantId);
  }

  @RequireAnyStorePermission(...SETTINGS_ADMIN)
  @Patch()
  async update(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateSalesSettingsDto,
  ): Promise<SalesSettingsResponseDto> {
    return this.salesSettingsService.update(tenant.tenantId, dto);
  }
}
