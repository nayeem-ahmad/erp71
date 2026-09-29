import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { PurchaseQuotationsService } from './purchase-quotations.service';
import { CreatePurchaseQuotationDto, UpdatePurchaseQuotationStatusDto } from './purchase-quotation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PURCHASE_READ, PURCHASE_WRITE } from '../auth/permission-sets';
@Controller('purchase-quotations')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PurchaseQuotationsController {
    constructor(private readonly service: PurchaseQuotationsService) {}

    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseQuotationDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PaginationDto,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
    ) {
        return this.service.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom,
            createdTo,
        });
    }

    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @Post(':id/convert')
    convertToPurchaseOrder(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.convertToPurchaseOrder(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @Patch(':id/status')
    updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdatePurchaseQuotationStatusDto) {
        return this.service.updateStatus(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
