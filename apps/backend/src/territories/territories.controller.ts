import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { TerritoriesService } from './territories.service';
import { CreateTerritoryDto, UpdateTerritoryDto } from './territory.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ImportRowsDto } from '../common/import.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CUSTOMER_READ, SALES_SETUP_WRITE } from '../auth/permission-sets';
@Controller('territories')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class TerritoriesController {
    constructor(private readonly service: TerritoriesService) {}

    @RequireAnyStorePermission(...SALES_SETUP_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateTerritoryDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...SALES_SETUP_WRITE)
    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.service.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @RequireAnyStorePermission(...CUSTOMER_READ)
    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.service.findAll(tenant.tenantId, query.page, query.limit);
    }

    @RequireAnyStorePermission(...CUSTOMER_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SALES_SETUP_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateTerritoryDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...SALES_SETUP_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
