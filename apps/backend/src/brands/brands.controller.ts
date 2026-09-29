import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateBrandDto, UpdateBrandDto } from './brand.dto';
import { BrandsService } from './brands.service';
import { ImportRowsDto } from '../common/import.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { BRAND_WRITE, CATALOG_READ } from '../auth/permission-sets';
@Controller('brands')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class BrandsController {
    constructor(private readonly brandsService: BrandsService) {}

    @RequireAnyStorePermission(...BRAND_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateBrandDto) {
        return this.brandsService.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...BRAND_WRITE)
    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.brandsService.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.brandsService.findAll(tenant.tenantId, query.page, query.limit);
    }

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.brandsService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...BRAND_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateBrandDto) {
        return this.brandsService.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...BRAND_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.brandsService.remove(tenant.tenantId, id);
    }
}
