import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmLeadsService } from './crm-leads.service';
import { BulkLeadActionDto, CreateLeadDto, ListLeadsDto, UpdateLeadDto } from './crm-leads.dto';
import { ImportRowsDto } from '../common/import.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CRM_STAFF, CRM_WRITE } from '../auth/permission-sets';
@Controller('crm/leads')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmLeadsController {
    constructor(private readonly service: CrmLeadsService) {}

    @RequireAnyStorePermission(...CRM_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateLeadDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto, tenant.timezone);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.service.importRows(tenant.tenantId, body.rows, body.mode, tenant.timezone);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Post('bulk-actions')
    bulkAction(@Tenant() tenant: TenantContext, @Body() dto: BulkLeadActionDto) {
        return this.service.bulkAction(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: ListLeadsDto) {
        return this.service.findAll(tenant.tenantId, { timezone: tenant.timezone,
            ...query,
            userId: tenant.userId,
        });
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext) {
        return this.service.getStatusSummary(tenant.tenantId);
    }

    /**
     * Options for every CRM person-picker (lead owner, contact owner, activity
     * assignee). Declared before `:id` so `/crm/leads/assignees` is never read
     * as a lead id.
     */
    @RequireAnyStorePermission(...CRM_STAFF)
    @Get('assignees')
    listAssignees(@Tenant() tenant: TenantContext) {
        return this.service.listAssignees(tenant.tenantId);
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Post(':id/convert')
    convert(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.convert(tenant.tenantId, id, tenant.storeId);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}