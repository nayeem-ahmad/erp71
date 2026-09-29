import { Controller, Get, Post, Delete, Patch, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { DiscountCodesService } from './discount-codes.service';
import { CreateDiscountCodeDto, ValidateDiscountCodeDto } from './discount-codes.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PROMO_MANAGE, SALES_STAFF } from '../auth/permission-sets';
@Controller('discount-codes')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class DiscountCodesController {
    constructor(private readonly service: DiscountCodesService) {}

    @RequireAnyStorePermission(...PROMO_MANAGE)
    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.service.list(tenant.tenantId, query.page, query.limit);
    }

    @RequireAnyStorePermission(...PROMO_MANAGE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateDiscountCodeDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...SALES_STAFF)
    @Post('validate')
    validate(@Tenant() tenant: TenantContext, @Body() dto: ValidateDiscountCodeDto) {
        return this.service.validate(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...SALES_STAFF)
    @Post(':code/use')
    recordUsage(@Tenant() tenant: TenantContext, @Param('code') code: string) {
        return this.service.recordUsage(tenant.tenantId, code);
    }

    @RequireAnyStorePermission(...PROMO_MANAGE)
    @Patch(':id/toggle')
    toggle(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.toggle(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PROMO_MANAGE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
