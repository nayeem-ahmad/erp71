import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CATALOG_READ, PRODUCT_WRITE } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateProductFamilyDto, UpdateProductFamilyDto } from './product-family.dto';
import { ProductFamiliesService } from './product-families.service';

/**
 * Storefront variant families ("Group as variants" on the products list).
 * Grouping changes what the storefront shows, nothing else, so it needs the
 * same permission as editing a product.
 */
@Controller('product-families')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProductFamiliesController {
    constructor(private readonly service: ProductFamiliesService) {}

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get()
    findAll(@Tenant() tenant: TenantContext) {
        return this.service.findAll(tenant.tenantId);
    }

    /** Declared before `:id`, which would otherwise match `suggestions` as an id. */
    @RequireAnyStorePermission(...CATALOG_READ)
    @Get('suggestions')
    suggestions(@Tenant() tenant: TenantContext) {
        return this.service.suggestions(tenant.tenantId);
    }

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateProductFamilyDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateProductFamilyDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
