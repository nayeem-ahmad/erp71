import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CountersService } from './counters.service';
import { CreateCounterDto, UpdateCounterDto } from './counter.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@ApiTags('counters')
@ApiBearerAuth()
@Controller('counters')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class CountersController {
  constructor(private readonly countersService: CountersService) {}

  @Post()
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateCounterDto) {
    return this.countersService.create(tenant.tenantId, dto);
  }

  @Get()
  findByStore(@Tenant() tenant: TenantContext, @Query('storeId') storeId: string) {
    return this.countersService.findByStore(tenant.tenantId, storeId);
  }

  @Get('active')
  findActive(@Tenant() tenant: TenantContext, @Query('storeId') storeId: string) {
    return this.countersService.findActive(tenant.tenantId, storeId);
  }

  @Patch(':id')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateCounterDto,
  ) {
    return this.countersService.update(tenant.tenantId, id, dto);
  }

  @Delete(':id')
  remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.countersService.remove(tenant.tenantId, id);
  }
}
