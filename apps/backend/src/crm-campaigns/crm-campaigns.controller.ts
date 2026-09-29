import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmCampaignsService } from './crm-campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto } from './crm-campaigns.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CRM_CAMPAIGN_WRITE, CRM_STAFF } from '../auth/permission-sets';
@Controller('crm/campaigns')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmCampaignsController {
    constructor(private readonly service: CrmCampaignsService) {}

    @RequireAnyStorePermission(...CRM_CAMPAIGN_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateCampaignDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
    ) {
        return this.service.findAll(tenant.tenantId, { timezone: tenant.timezone,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            createdFrom,
            createdTo,
        });
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get(':id/preview')
    previewRecipients(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.previewRecipients(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...CRM_CAMPAIGN_WRITE)
    @Post(':id/send')
    send(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.send(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...CRM_CAMPAIGN_WRITE)
    @Post(':id/cancel')
    cancel(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.cancel(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...CRM_CAMPAIGN_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...CRM_CAMPAIGN_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
