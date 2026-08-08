import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ProductDemandsService } from './product-demands.service';
import {
    CreateProductDemandDto,
    FulfilProductDemandDto,
    ListProductDemandsQueryDto,
    ReviewProductDemandDto,
    UpdateProductDemandDto,
} from './product-demand.dto';

/**
 * Reads sit on VIEW_PRODUCT_CATALOG rather than on either demand permission: an
 * approver holds APPROVE_PRODUCT_DEMAND and need not hold CREATE_PRODUCT_DEMAND,
 * and `StorePermissionGuard` requires *every* listed permission — so naming both
 * on the class would lock each side out of the other's list.
 */
@Controller('product-demands')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_PRODUCT_CATALOG)
@UseInterceptors(TenantInterceptor)
export class ProductDemandsController {
    constructor(private readonly service: ProductDemandsService) {}

    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: ListProductDemandsQueryDto) {
        return this.service.findAll(tenant.tenantId, query, tenant.userId);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Post()
    @RequireStorePermission(StorePermission.CREATE_PRODUCT_DEMAND)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateProductDemandDto) {
        return this.service.create(tenant.tenantId, dto, {
            userId: tenant.userId,
            storeId: tenant.storeId,
        });
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.CREATE_PRODUCT_DEMAND)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateProductDemandDto,
    ) {
        return this.service.update(tenant.tenantId, id, dto, {
            userId: tenant.userId,
            userRole: tenant.userRole,
        });
    }

    @Post(':id/submit')
    @RequireStorePermission(StorePermission.CREATE_PRODUCT_DEMAND)
    @HttpCode(HttpStatus.OK)
    submit(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.submit(tenant.tenantId, id, {
            userId: tenant.userId,
            userRole: tenant.userRole,
        });
    }

    @Post(':id/cancel')
    @RequireStorePermission(StorePermission.CREATE_PRODUCT_DEMAND)
    @HttpCode(HttpStatus.OK)
    cancel(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.cancel(tenant.tenantId, id, {
            userId: tenant.userId,
            userRole: tenant.userRole,
        });
    }

    @Post(':id/review')
    @RequireStorePermission(StorePermission.APPROVE_PRODUCT_DEMAND)
    @HttpCode(HttpStatus.OK)
    review(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReviewProductDemandDto,
    ) {
        return this.service.review(tenant.tenantId, id, dto, tenant.userId);
    }

    @Post(':id/fulfil')
    @RequireStorePermission(StorePermission.APPROVE_PRODUCT_DEMAND)
    @HttpCode(HttpStatus.OK)
    fulfil(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: FulfilProductDemandDto,
    ) {
        return this.service.fulfil(tenant.tenantId, id, dto, tenant.userId);
    }
}
