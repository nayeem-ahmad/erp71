import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { StorePermission } from '@erp71/shared-types';
import { CountersService } from './counters.service';
import { CreateCounterDto, UpdateCounterDto } from './counter.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { COUNTER_READ, COUNTER_WRITE } from '../auth/permission-sets';
@ApiTags('counters')
@ApiBearerAuth()
@Controller('counters')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CountersController {
  constructor(
    private readonly countersService: CountersService,
    private readonly branchScope: BranchScopeService,
  ) {}

  /** Counters belong to one branch; the id must be one the caller may use. */
  private async branch(
    tenant: TenantContext,
    storeId: string | undefined,
    permissions: readonly StorePermission[],
  ): Promise<string> {
    return (await this.branchScope.resolveStoreId(tenant, storeId, { permissions, allowAll: false })) as string;
  }

  @RequireAnyStorePermission(...COUNTER_WRITE)
  @Post()
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateCounterDto) {
    const storeId = await this.branch(tenant, dto.storeId, COUNTER_WRITE);
    return this.countersService.create(tenant.tenantId, { ...dto, storeId });
  }

  @RequireAnyStorePermission(...COUNTER_READ)
  @Get()
  async findByStore(@Tenant() tenant: TenantContext, @Query('storeId') storeId?: string) {
    return this.countersService.findByStore(tenant.tenantId, await this.branch(tenant, storeId, COUNTER_READ));
  }

  @RequireAnyStorePermission(...COUNTER_READ)
  @Get('active')
  async findActive(@Tenant() tenant: TenantContext, @Query('storeId') storeId?: string) {
    return this.countersService.findActive(tenant.tenantId, await this.branch(tenant, storeId, COUNTER_READ));
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
