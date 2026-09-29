import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateProductSubgroupDto, UpdateProductSubgroupDto } from './product-subgroup.dto';
import { ProductSubgroupsService } from './product-subgroups.service';
import { ImportRowsDto } from '../common/import.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { BRAND_WRITE, CATALOG_READ } from '../auth/permission-sets';
@Controller('product-subgroups')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProductSubgroupsController {
    constructor(private readonly service: ProductSubgroupsService) {}

    @RequireAnyStorePermission(...BRAND_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateProductSubgroupDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...BRAND_WRITE)
    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.service.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: PaginationDto, @Query('groupId') groupId?: string) {
        return this.service.findAll(tenant.tenantId, groupId, query.page, query.limit);
    }

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...BRAND_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateProductSubgroupDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...BRAND_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}