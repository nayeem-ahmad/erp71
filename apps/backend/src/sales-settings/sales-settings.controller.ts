import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/shared/auth/jwt-auth.guard';
import { CurrentTenant } from '@/shared/decorators/current-tenant.decorator';
import { SalesSettingsService } from './sales-settings.service';
import { UpdateSalesSettingsDto, SalesSettingsResponseDto } from './sales-settings.dto';

@Controller('sales-settings')
@UseGuards(JwtAuthGuard)
export class SalesSettingsController {
  constructor(private readonly salesSettingsService: SalesSettingsService) {}

  @Get()
  async get(@CurrentTenant() tenantId: string): Promise<SalesSettingsResponseDto> {
    return this.salesSettingsService.get(tenantId);
  }

  @Patch()
  async update(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateSalesSettingsDto,
  ): Promise<SalesSettingsResponseDto> {
    return this.salesSettingsService.update(tenantId, dto);
  }
}
