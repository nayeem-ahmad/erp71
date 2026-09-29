import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmFollowUpsService } from './crm-follow-ups.service';
import { CreateCrmFollowUpDto, UpdateCrmFollowUpDto } from './crm-follow-ups.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CRM_STAFF, CRM_WRITE } from '../auth/permission-sets';
@Controller('crm/follow-ups')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmFollowUpsController {
    constructor(private readonly service: CrmFollowUpsService) {}

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get('summary')
    getTodaySummary(@Tenant() tenant: TenantContext) {
        return this.service.getTodaySummary(tenant.tenantId, tenant.timezone);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateCrmFollowUpDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('customerId') customerId?: string,
        @Query('leadId') leadId?: string,
        @Query('target') target?: 'customer' | 'lead',
        @Query('status') status?: string,
        @Query('dueToday') dueToday?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            timezone: tenant.timezone,
            customerId,
            leadId,
            target,
            status,
            dueToday: dueToday === 'true',
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
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCrmFollowUpDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
