import { Controller, Get, Patch, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import type { InvoicePrintPrefs } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SalesSettingsService } from './sales-settings.service';
import {
  UpdateSalesSettingsDto,
  SalesSettingsResponseDto,
  UpdateMemberInvoicePrintDto,
} from './sales-settings.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SALES_READ, SETTINGS_ADMIN } from '../auth/permission-sets';
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

  /**
   * The signed-in member's own invoice layout. Gated on reading sales — the
   * people who print invoices — and self-scoped: it reads and writes only the
   * caller's membership, so no admin permission is involved.
   */
  @RequireAnyStorePermission(...SALES_READ)
  @Get('my-invoice-print')
  async getMyInvoicePrint(@Tenant() tenant: TenantContext): Promise<InvoicePrintPrefs> {
    return this.salesSettingsService.getMemberInvoicePrint(tenant.tenantId, tenant.userId);
  }

  @RequireAnyStorePermission(...SALES_READ)
  @Patch('my-invoice-print')
  async updateMyInvoicePrint(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateMemberInvoicePrintDto,
  ): Promise<InvoicePrintPrefs> {
    return this.salesSettingsService.updateMemberInvoicePrint(tenant.tenantId, tenant.userId, dto);
  }
}
