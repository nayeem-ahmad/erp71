import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CountersService } from './counters.service';
import { CreateCounterDto, UpdateCounterDto } from './counter.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { COUNTER_READ, COUNTER_WRITE } from '../auth/permission-sets';
@ApiTags('counters')
@ApiBearerAuth()
@Controller('counters')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CountersController {
  constructor(private readonly countersService: CountersService) {}

  @RequireAnyStorePermission(...COUNTER_WRITE)
  @Post()
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateCounterDto) {
    return this.countersService.create(tenant.tenantId, dto);
  }

  @RequireAnyStorePermission(...COUNTER_READ)
  @Get()
  findByStore(@Tenant() tenant: TenantContext, @Query('storeId') storeId: string) {
    return this.countersService.findByStore(tenant.tenantId, storeId);
  }

  @RequireAnyStorePermission(...COUNTER_READ)
  @Get('active')
  findActive(@Tenant() tenant: TenantContext, @Query('storeId') storeId: string) {
    return this.countersService.findActive(tenant.tenantId, storeId);
  }

  @RequireAnyStorePermission(...COUNTER_WRITE)
  @Patch(':id')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateCounterDto,
  ) {
    return this.countersService.update(tenant.tenantId, id, dto);
  }

  @RequireAnyStorePermission(...COUNTER_WRITE)
  @Delete(':id')
  remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.countersService.remove(tenant.tenantId, id);
  }
}
