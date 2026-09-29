import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmInteractionsService } from './crm-interactions.service';
import { CreateInteractionDto, UpdateInteractionDto } from './crm-interactions.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CRM_STAFF, CRM_WRITE } from '../auth/permission-sets';
@Controller('crm/interactions')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CrmInteractionsController {
    constructor(private readonly service: CrmInteractionsService) {}

    @RequireAnyStorePermission(...CRM_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateInteractionDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('customerId') customerId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            customerId,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateInteractionDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
