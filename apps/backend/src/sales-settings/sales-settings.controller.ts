import { Controller, Get, Patch, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SalesSettingsService } from './sales-settings.service';
import { UpdateSalesSettingsDto, SalesSettingsResponseDto } from './sales-settings.dto';

@Controller('sales-settings')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SalesSettingsController {
  constructor(private readonly salesSettingsService: SalesSettingsService) {}

  @Get()
  async get(@Tenant() tenant: TenantContext): Promise<SalesSettingsResponseDto> {
    return this.salesSettingsService.get(tenant.tenantId);
  }

  @Patch()
  async update(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateSalesSettingsDto,
  ): Promise<SalesSettingsResponseDto> {
    return this.salesSettingsService.update(tenant.tenantId, dto);
  }
}
